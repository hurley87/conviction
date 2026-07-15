import { describe, expect, it, vi } from "vitest";
import {
  failedCheckName,
  formatGateReport,
  resolveGateChain,
  runGateCheck,
} from "@/lib/gate";
import { ARBITRUM_CHAIN_ID, BASE_CHAIN_ID } from "@/lib/verbs/chains";
import { routerCheckFromWarmUp } from "@/lib/gate/routability";
import type { WarmUpAccount } from "@/lib/ua/warm-up";

const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const ARB = "0x912CE59144191C1204E64559FE8253a0e49E6548";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

/** Mock fetch covering GeckoTerminal pools + Blockscout contract/holders. */
function mockFetch(opts: {
  liquidityUsd?: number;
  verified?: boolean;
  topHolderFraction?: number;
  totalSupply?: string;
}): typeof fetch {
  const liquidityUsd = opts.liquidityUsd ?? 120_000;
  const verified = opts.verified ?? true;
  const topHolderFraction = opts.topHolderFraction ?? 0.2;
  const totalSupply = opts.totalSupply ?? "1000000";
  const topValue = String(
    Math.floor(Number(totalSupply) * topHolderFraction),
  );

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("geckoterminal.com") && url.includes("/pools")) {
      return jsonResponse({
        data: [
          {
            attributes: {
              reserve_in_usd: String(liquidityUsd),
              address: "0xpool",
            },
          },
        ],
      });
    }

    if (url.includes("/api/v2/smart-contracts/")) {
      if (!verified) {
        return jsonResponse({}, false, 404);
      }
      return jsonResponse({ is_verified: true });
    }

    if (url.includes("/api/v2/tokens/") && url.includes("/holders")) {
      return jsonResponse({
        items: [{ value: topValue }],
      });
    }

    if (url.includes("/api/v2/tokens/")) {
      return jsonResponse({ total_supply: totalSupply });
    }

    return jsonResponse({}, false, 404);
  }) as unknown as typeof fetch;
}

describe("resolveGateChain", () => {
  it("resolves names and ids", () => {
    expect(resolveGateChain("base").chainId).toBe(BASE_CHAIN_ID);
    expect(resolveGateChain("arbitrum").chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(resolveGateChain(1).geckoNetwork).toBe("eth");
  });

  it("rejects unknown chains", () => {
    expect(() => resolveGateChain("solana")).toThrow(/Unsupported chain/);
  });
});

describe("runGateCheck (mocked HTTP + warm-up, ADR 0014)", () => {
  it("returns three GateCheck entries with evidence links when all pass", async () => {
    const report = await runGateCheck(DEGEN, "base", {
      fetch: mockFetch({}),
      checkRouter: async () => true,
    });

    expect(report).toHaveLength(3);
    expect(report.every((c) => c.passed)).toBe(true);
    expect(report.map((c) => c.name)).toEqual([
      "Liquidity depth",
      "Contract verification and holder concentration",
      "UA routability",
    ]);
    expect(report[0]?.evidenceUrl).toContain("geckoterminal.com/base");
    expect(report[1]?.evidenceUrl).toContain("basescan.org/token");
    expect(failedCheckName(report)).toBeUndefined();
  });

  it("fails liquidity with plain-language name usable on a gate-kill card", async () => {
    const report = await runGateCheck(DEGEN, "base", {
      fetch: mockFetch({ liquidityUsd: 1_000 }),
      checkRouter: async () => true,
    });

    const liq = report[0];
    expect(liq?.passed).toBe(false);
    expect(liq?.name).toBe("Liquidity is too thin to back safely");
    expect(failedCheckName(report)).toBe("Liquidity is too thin to back safely");
  });

  it("fails unverified contracts in plain language", async () => {
    const report = await runGateCheck(DEGEN, "base", {
      fetch: mockFetch({ verified: false }),
      checkRouter: async () => true,
    });

    expect(report[1]?.passed).toBe(false);
    expect(report[1]?.name).toBe("Contract source is not verified");
  });

  it("fails concentrated holders in plain language", async () => {
    const report = await runGateCheck(DEGEN, "base", {
      fetch: mockFetch({ topHolderFraction: 0.8 }),
      checkRouter: async () => true,
    });

    expect(report[1]?.passed).toBe(false);
    expect(report[1]?.name).toBe("Top holders own too much of the supply");
  });

  it("fails Arbitrum non-primary routability via warm-up seam (ARB case)", async () => {
    const arbUa: WarmUpAccount = {
      warmUpToken: vi.fn(async () => ({ router: null })),
      getTokenPair: vi.fn(async () => null),
    };

    const report = await runGateCheck(ARB, "arbitrum", {
      fetch: mockFetch({ liquidityUsd: 5_000_000 }),
      checkRouter: routerCheckFromWarmUp(arbUa, { sleep: async () => {} }),
    });

    const route = report[2];
    expect(route?.passed).toBe(false);
    expect(route?.name).toBe("No route through your Universal Account");
    expect(arbUa.warmUpToken).toHaveBeenCalledWith({
      chainId: ARBITRUM_CHAIN_ID,
      address: ARB,
    });
    expect(formatGateReport(report)).toContain(
      "Gate kill: No route through your Universal Account",
    );
  });

  it("passes routability for a Base token when warm-up finds a pair", async () => {
    const baseUa: WarmUpAccount = {
      warmUpToken: vi.fn(async () => ({ router: { id: "ok" } })),
      getTokenPair: vi.fn(async () => ({
        pair: { address: "0xpair", factory: "0xfactory" },
      })),
    };

    const report = await runGateCheck(DEGEN, BASE_CHAIN_ID, {
      fetch: mockFetch({}),
      checkRouter: routerCheckFromWarmUp(baseUa, { sleep: async () => {} }),
    });

    expect(report[2]?.passed).toBe(true);
    expect(report[2]?.name).toBe("UA routability");
    expect(baseUa.getTokenPair).toHaveBeenCalled();
  });

  it("rejects invalid addresses", async () => {
    await expect(
      runGateCheck("not-an-address", "base", {
        fetch: mockFetch({}),
        checkRouter: async () => true,
      }),
    ).rejects.toThrow(/Invalid token address/);
  });
});
