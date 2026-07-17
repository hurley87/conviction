import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import {
  acquireAgentLease,
  buildAgentAccountStatus,
  releaseAgentLease,
  renewAgentLease,
} from "@/lib/agent-lease";
import {
  buildProvisioningProofMessage,
  createPendingAgent,
  hashProvisioningCode,
  MemoryAgentProvisioningStore,
  redeemPendingAgent,
} from "@/lib/agent-provisioning";

const OWNER = { userId: "did:privy:owner-lease", operatorHandle: "operator" };
const FIXED_NOW = new Date("2026-07-17T12:00:00.000Z");

async function activeAgent(store: MemoryAgentProvisioningStore, wallet: Wallet) {
  const created = await createPendingAgent(
    store,
    OWNER,
    {
      handle: "lease-scout",
      returnAddress: "0x0000000000000000000000000000000000000001",
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      actionPolicy: { trade: true, back: false, publish: true },
    },
    {
      now: () => FIXED_NOW,
      randomId: (() => {
        const ids = [
          "00000000-0000-4000-8000-0000000000b1",
          "00000000-0000-4000-8000-0000000000b2",
        ];
        return () => ids.shift()!;
      })(),
      randomCode: () => "lease-provisioning-code",
    },
  );
  const codeHash = hashProvisioningCode(created.handoff.code);
  const proofSignature = await wallet.signMessage(
    buildProvisioningProofMessage(codeHash, wallet.address),
  );
  return redeemPendingAgent(
    store,
    {
      code: created.handoff.code,
      signerAddress: wallet.address,
      proofSignature,
    },
    { now: () => FIXED_NOW },
  );
}

describe("MCP lease lifecycle", () => {
  it("acquires one lease and rejects a second concurrent process with actionable details", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);

    const first = await acquireAgentLease(store, agent, {
      now: () => FIXED_NOW,
      randomId: () => "lease-one",
    });
    expect(first.leaseId).toBe("lease-one");

    await expect(
      acquireAgentLease(store, agent, {
        now: () => FIXED_NOW,
        randomId: () => "lease-two",
      }),
    ).rejects.toMatchObject({
      code: "lease_conflict",
      details: {
        activeLeaseId: "lease-one",
        activeLeaseExpiresAt: first.expiresAt,
      },
    });
  });

  it("only one of two concurrent acquires wins in memory", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);
    let n = 0;

    const results = await Promise.allSettled([
      acquireAgentLease(store, agent, {
        now: () => FIXED_NOW,
        randomId: () => `lease-concurrent-${++n}`,
      }),
      acquireAgentLease(store, agent, {
        now: () => FIXED_NOW,
        randomId: () => `lease-concurrent-${++n}`,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "lease_conflict" }),
    });
  });

  it("renews an owned lease and fails after replacement", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);

    const first = await acquireAgentLease(store, agent, {
      now: () => FIXED_NOW,
      randomId: () => "lease-one",
    });

    const renewed = await renewAgentLease(store, agent, first.leaseId, {
      now: () => new Date(FIXED_NOW.getTime() + 30_000),
    });
    expect(renewed.leaseId).toBe("lease-one");
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(
      new Date(first.expiresAt).getTime(),
    );

    await acquireAgentLease(store, agent, {
      now: () => new Date(FIXED_NOW.getTime() + 40_000),
      randomId: () => "lease-replacement",
      replace: true,
    });

    await expect(
      renewAgentLease(store, agent, first.leaseId, {
        now: () => new Date(FIXED_NOW.getTime() + 50_000),
      }),
    ).rejects.toMatchObject({ code: "lease_conflict" });
  });

  it("releases a lease so another process can acquire", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);

    const first = await acquireAgentLease(store, agent, {
      now: () => FIXED_NOW,
      randomId: () => "lease-one",
    });
    await releaseAgentLease(store, agent, first.leaseId);

    const second = await acquireAgentLease(store, agent, {
      now: () => FIXED_NOW,
      randomId: () => "lease-two",
    });
    expect(second.leaseId).toBe("lease-two");
  });

  it("builds account status from backend-authoritative policy without secrets", () => {
    const status = buildAgentAccountStatus({
      agentId: "00000000-0000-4000-8000-0000000000b1",
      ownerUserId: OWNER.userId,
      handle: "lease-scout",
      authorKind: "agent",
      operatorHandle: "operator",
      address: "0x00000000000000000000000000000000000000Aa",
      returnAddress: "0x0000000000000000000000000000000000000001",
      status: "active",
      publicStatus: "active",
      actionPolicy: { trade: true, back: false, publish: true },
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      lifetimeSpendUsd: 40,
      fundingReady: true,
      setupVerifiedAt: null,
      createdAt: FIXED_NOW.toISOString(),
    });

    expect(status).toMatchObject({
      ok: true,
      mode: "live",
      handle: "lease-scout",
      remainingBudgetUsd: 60,
      actionPolicy: { trade: true, back: false, publish: true },
      fundingReady: true,
      setupVerifiedAt: null,
    });
    expect(status).not.toHaveProperty("funded");
    expect(JSON.stringify(status)).not.toMatch(
      /privateKey|mnemonic|keystore|signature/i,
    );
  });

  it("rejects lease acquisition for retiring or retired agents", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);
    agent.status = "retiring";
    agent.publicStatus = "paused";

    await expect(
      acquireAgentLease(store, agent, {
        now: () => FIXED_NOW,
        randomId: () => "lease-blocked",
      }),
    ).rejects.toMatchObject({ code: "lifecycle_blocked" });
  });

  it("reports lease age from acquiredAt across renewals", async () => {
    const store = new MemoryAgentProvisioningStore();
    const wallet = Wallet.createRandom();
    const agent = await activeAgent(store, wallet);

    const first = await acquireAgentLease(store, agent, {
      now: () => FIXED_NOW,
      randomId: () => "lease-one",
    });
    expect(first.acquiredAt).toBe(FIXED_NOW.toISOString());

    const later = new Date(FIXED_NOW.getTime() + 45_000);
    const renewed = await renewAgentLease(store, agent, first.leaseId, {
      now: () => later,
    });
    expect(renewed.acquiredAt).toBe(FIXED_NOW.toISOString());

    await expect(
      acquireAgentLease(store, agent, {
        now: () => later,
        randomId: () => "lease-two",
      }),
    ).rejects.toMatchObject({
      code: "lease_conflict",
      details: { leaseAgeMs: 45_000 },
    });
  });
});
