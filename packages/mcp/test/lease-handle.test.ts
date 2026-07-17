import { describe, expect, it, vi } from "vitest";
import { Wallet } from "ethers";

import { ConvictionApiError } from "../src/api-client.js";
import { LeaseHandle } from "../src/lease.js";

function handleWithFetch(
  wallet: Wallet,
  fetchImpl: typeof fetch,
  overrides: {
    expiresAt?: string;
    maxTransientFailures?: number;
    now?: () => number;
  } = {},
) {
  const now = Date.now();
  return new LeaseHandle(
    {
      leaseId: "lease-1",
      agentId: "00000000-0000-4000-8000-000000000111",
      expiresAt: overrides.expiresAt ?? new Date(now + 120_000).toISOString(),
      acquiredAt: new Date(now).toISOString(),
    },
    {
      apiBaseUrl: "http://conviction.test",
      wallet,
      fetchImpl,
      ...(overrides.maxTransientFailures !== undefined
        ? { maxTransientFailures: overrides.maxTransientFailures }
        : {}),
      ...(overrides.now ? { now: overrides.now } : {}),
    },
  );
}

describe("LeaseHandle renew resilience", () => {
  it("tolerates transient renew failures until the threshold", async () => {
    const wallet = Wallet.createRandom();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return new Response(
          JSON.stringify({
            error: { code: "unavailable", message: "blip" },
          }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({
          lease: {
            leaseId: "lease-1",
            agentId: "00000000-0000-4000-8000-000000000111",
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            acquiredAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const handle = handleWithFetch(wallet, fetchImpl, {
      maxTransientFailures: 3,
    });
    const onLost = vi.fn();
    handle.onLost(onLost);

    await handle.renewOnce();
    await handle.renewOnce();
    expect(onLost).not.toHaveBeenCalled();
    expect(handle.isActive).toBe(true);

    await handle.renewOnce();
    expect(onLost).not.toHaveBeenCalled();
    expect(handle.isActive).toBe(true);
  });

  it("fails closed after sustained transient renew failures", async () => {
    const wallet = Wallet.createRandom();
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: "unavailable", message: "blip" },
        }),
        { status: 503 },
      );

    const handle = handleWithFetch(wallet, fetchImpl, {
      maxTransientFailures: 2,
    });
    const onLost = vi.fn();
    handle.onLost(onLost);

    await handle.renewOnce();
    expect(onLost).not.toHaveBeenCalled();
    await handle.renewOnce();
    expect(onLost).toHaveBeenCalledWith(
      "renewal_failed",
      expect.any(ConvictionApiError),
    );
    expect(handle.isLost).toBe(true);
  });

  it("marks lease inactive after local expiry even before renew", () => {
    const wallet = Wallet.createRandom();
    const handle = handleWithFetch(
      wallet,
      async () => new Response("{}", { status: 500 }),
      {
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        now: () => Date.now(),
      },
    );
    expect(handle.isActive).toBe(false);
  });
});
