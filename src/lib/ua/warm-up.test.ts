import { describe, expect, it, vi } from "vitest";
import {
  checkWarmUpRoute,
  NO_ROUTE_MESSAGE,
  warmUpTokenPair,
  type WarmUpAccount,
} from "@/lib/ua/warm-up";

const TOKEN = {
  chainId: 8453,
  address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
};

describe("warmUpTokenPair", () => {
  it("returns the pair when router and getTokenPair succeed", async () => {
    const ua: WarmUpAccount = {
      warmUpToken: vi.fn(async () => ({ router: { id: "r1" } })),
      getTokenPair: vi.fn(async () => ({
        pair: { address: "0xpair", factory: "0xfactory" },
      })),
    };

    await expect(
      warmUpTokenPair(ua, TOKEN, { sleep: async () => {} }),
    ).resolves.toEqual({
      address: "0xpair",
      factory: "0xfactory",
    });
    expect(ua.warmUpToken).toHaveBeenCalledWith(TOKEN);
  });

  it("throws when router is null (Arbitrum non-primary case)", async () => {
    const ua: WarmUpAccount = {
      warmUpToken: vi.fn(async () => ({ router: null })),
      getTokenPair: vi.fn(async () => null),
    };

    await expect(
      warmUpTokenPair(ua, TOKEN, { sleep: async () => {} }),
    ).rejects.toThrow(NO_ROUTE_MESSAGE);
    expect(ua.getTokenPair).not.toHaveBeenCalled();
  });

  it("polls getTokenPair until a pair appears", async () => {
    let calls = 0;
    const ua: WarmUpAccount = {
      warmUpToken: vi.fn(async () => ({ router: {} })),
      getTokenPair: vi.fn(async () => {
        calls += 1;
        if (calls < 3) return { pair: undefined };
        return { pair: { address: "0xlate", factory: "0xf" } };
      }),
    };

    const pair = await warmUpTokenPair(ua, TOKEN, {
      polls: 4,
      pollMs: 1,
      sleep: async () => {},
    });
    expect(pair.address).toBe("0xlate");
    expect(ua.getTokenPair).toHaveBeenCalledTimes(3);
  });
});

describe("checkWarmUpRoute", () => {
  it("returns no_route when warm-up finds no router", async () => {
    const ua: WarmUpAccount = {
      warmUpToken: async () => ({ router: null }),
      getTokenPair: async () => null,
    };
    await expect(
      checkWarmUpRoute(ua, TOKEN, { sleep: async () => {} }),
    ).resolves.toEqual({ status: "no_route" });
  });

  it("returns routable when a pair is found", async () => {
    const ua: WarmUpAccount = {
      warmUpToken: async () => ({ router: {} }),
      getTokenPair: async () => ({
        pair: { address: "0xpair", factory: "0xf" },
      }),
    };
    await expect(
      checkWarmUpRoute(ua, TOKEN, { sleep: async () => {} }),
    ).resolves.toEqual({ status: "routable" });
  });

  it("returns error when warm-up throws unexpectedly", async () => {
    const ua: WarmUpAccount = {
      warmUpToken: async () => {
        throw new Error("network down");
      },
      getTokenPair: async () => null,
    };
    await expect(
      checkWarmUpRoute(ua, TOKEN, { sleep: async () => {} }),
    ).resolves.toEqual({ status: "error", message: "network down" });
  });
});
