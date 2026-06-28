import { describe, it, expect } from "vitest";
import { toUniversalBalance, chainName } from "@/lib/verbs/map-balance";
import { MockUAClient } from "@/lib/ua/mock";

describe("chainName", () => {
  it("maps known chain ids to human names", () => {
    expect(chainName(42161)).toBe("Arbitrum");
    expect(chainName(8453)).toBe("Base");
  });
  it("falls back for unknown ids", () => {
    expect(chainName(999999)).toBe("Chain 999999");
    expect(chainName(undefined)).toBe("Unknown");
  });
});

describe("toUniversalBalance", () => {
  it("flattens per-chain aggregations into one source per chain+asset", () => {
    const balance = toUniversalBalance({
      totalAmountInUSD: 242.5,
      assets: [
        {
          tokenType: "USDC",
          amountInUSD: 180,
          chainAggregation: [
            { token: { chainId: 42161, symbol: "USDC" }, amountInUSD: 180 },
          ],
        },
        {
          tokenType: "ETH",
          amountInUSD: 62.5,
          chainAggregation: [
            { token: { chainId: 8453, symbol: "ETH" }, amountInUSD: 62.5 },
          ],
        },
      ],
    });

    expect(balance.totalUsd).toBe(242.5);
    expect(balance.sources).toEqual([
      { chain: "Arbitrum", asset: "USDC", usd: 180 },
      { chain: "Base", asset: "ETH", usd: 62.5 },
    ]);
  });

  it("uses the SDK total verbatim and drops zero-value slices", () => {
    const balance = toUniversalBalance({
      totalAmountInUSD: 10,
      assets: [
        {
          tokenType: "USDC",
          chainAggregation: [
            { token: { chainId: 1, symbol: "USDC" }, amountInUSD: 10 },
            { token: { chainId: 137, symbol: "USDC" }, amountInUSD: 0 },
          ],
        },
      ],
    });
    expect(balance.totalUsd).toBe(10);
    expect(balance.sources).toHaveLength(1);
  });

  it("derives a total when the SDK omits one", () => {
    const balance = toUniversalBalance({
      assets: [
        {
          tokenType: "USDC",
          chainAggregation: [
            { token: { chainId: 42161, symbol: "USDC" }, amountInUSD: 5 },
            { token: { chainId: 8453, symbol: "USDC" }, amountInUSD: 7 },
          ],
        },
      ],
    });
    expect(balance.totalUsd).toBe(12);
  });
});

describe("MockUAClient (the test/dev seam)", () => {
  it("reports a unified balance summing its sources across ≥2 chains", async () => {
    const ua = new MockUAClient();
    const balance = await ua.getUniversalBalance();
    expect(balance.sources.length).toBeGreaterThanOrEqual(2);
    const summed = balance.sources.reduce((s, r) => s + r.usd, 0);
    expect(balance.totalUsd).toBeCloseTo(summed, 6);
  });

  it("upgrades in place exactly once (idempotent)", async () => {
    const ua = new MockUAClient();
    expect(await ua.ensureUpgraded()).toEqual({
      upgraded: true,
      alreadyUpgraded: false,
    });
    expect(await ua.ensureUpgraded()).toEqual({
      upgraded: false,
      alreadyUpgraded: true,
    });
  });
});
