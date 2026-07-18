import { describe, expect, it } from "vitest";
import { MemoryAgentAuditStore } from "@/lib/agent-audit";
import { MemorySpendLedger } from "@/lib/agent-execute";
import {
  MemoryAgentPermitStore,
  type ExecutionPermitRecord,
} from "@/lib/agent-permit";
import { enableAgent } from "@/lib/agent-policy";
import {
  createPendingAgent,
  MemoryAgentProvisioningStore,
  type OwnedAgent,
} from "@/lib/agent-provisioning";
import {
  assertRetirementOwnership,
  canUseMockRetirementRecovery,
  classifyHoldings,
  executeRetirementRecovery,
  MemoryAgentRetirementStore,
  reconcileRetirementResiduals,
  RETIREMENT_DUST_THRESHOLD_USD,
  retryRetirementRecovery,
  startRetirement,
} from "@/lib/agent-retirement";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import { AgentProvisioningError } from "@/lib/agent-provisioning";

const OWNER = { userId: "did:privy:retire-owner", operatorHandle: "operator" };
const FIXED_NOW = new Date("2026-07-18T15:00:00.000Z");
const RETURN_ADDRESS = "0x00000000000000000000000000000000000000bb";

async function seedActiveAgent(
  store: MemoryAgentProvisioningStore,
  overrides: Partial<OwnedAgent> = {},
): Promise<OwnedAgent> {
  const ids = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  ];
  const created = await createPendingAgent(
    store,
    OWNER,
    {
      handle: "retire-scout",
      returnAddress: RETURN_ADDRESS,
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      actionPolicy: { trade: true, back: true, publish: true },
    },
    {
      now: () => FIXED_NOW,
      randomId: () => ids.shift()!,
      randomCode: () => "retire-test-code",
    },
  );
  const record = store.records.find(
    ({ agent }) => agent.agentId === created.agent.agentId,
  );
  if (!record) throw new Error("missing seeded agent");
  record.agent.address = "0x00000000000000000000000000000000000000aa";
  record.agent.status = "active";
  record.agent.publicStatus = "active";
  record.agent.fundingReady = true;
  Object.assign(record.agent, overrides);
  return record.agent;
}

function issuedPermit(agentId: string): ExecutionPermitRecord {
  return {
    permitId: "permit-retire-1",
    agentId,
    leaseId: "lease-1",
    quoteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    quoteFingerprint: "fp-retire",
    idempotencyKey: "idem-retire-1",
    action: "trade",
    dollarsIn: 10,
    floorUsd: 9,
    intent: { toAsset: "eth", sizeUsd: 10, destChain: "Arbitrum" },
    sizeUsd: 10,
    agreedQuote: {
      dollarsIn: 10,
      dollarsOut: 9.5,
      feeUsd: 0.1,
      etaSeconds: 45,
      floorUsd: 9,
      sourceChain: "Arbitrum",
      destChain: "Arbitrum",
      toAsset: "eth",
      transactionId: "tx-1",
      rawTransaction: {},
    },
    rawTransaction: {},
    issuedAt: FIXED_NOW.toISOString(),
    expiresAt: new Date(FIXED_NOW.getTime() + 30_000).toISOString(),
    status: "issued",
  };
}

describe("classifyHoldings", () => {
  it("separates canonical Arbitrum USDC, convertible funding assets, and residuals", () => {
    const classified = classifyHoldings({
      totalUsd: 100,
      sources: [
        { chain: "Arbitrum", asset: "USDC", usd: 40 },
        { chain: "Base", asset: "ETH", usd: 30 },
        { chain: "Arbitrum", asset: "ARB", usd: 20 },
        { chain: "Base", asset: "USDC", usd: 10 },
      ],
    });
    expect(classified.canonicalUsdcUsd).toBe(40);
    expect(classified.conversions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromAsset: "eth", fromChain: "Base" }),
        expect.objectContaining({ fromAsset: "usdc", fromChain: "Base" }),
      ]),
    );
    expect(classified.residuals).toEqual([
      expect.objectContaining({ asset: "ARB", usd: 20 }),
    ]);
  });
});

describe("agent retirement", () => {
  it("starts retirement, blocks writes via retiring status, and releases permits", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    await permitStore.save(issuedPermit(agent.agentId));
    spendLedger.tryReserve({
      agentId: agent.agentId,
      dollarsIn: 10,
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      lifetimeSpendUsd: 0,
    });

    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
      idempotencyKey: "retire-idem-1",
    });

    expect(started.agent.status).toBe("retiring");
    expect(started.agent.publicStatus).toBe("paused");
    expect(started.agent.retirementStartedAt).toBe(FIXED_NOW.toISOString());
    expect(started.releasedPermitCount).toBe(1);
    expect(started.retirement.returnAddress).toBe(RETURN_ADDRESS);
    expect(started.retirement.reconciliationState).toBe("pending_sync");
    expect(auditStore.events.map((event) => event.type)).toContain(
      "retirement_started",
    );

    // Idempotent restart returns the same durable record.
    const again = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
      idempotencyKey: "retire-idem-1",
    });
    expect(again.retirement.retirementId).toBe(
      started.retirement.retirementId,
    );
    expect(again.releasedPermitCount).toBe(0);
  });

  it("recovers convertible holdings to Arbitrum USDC and completes retirement", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);

    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
      idempotencyKey: "retire-recover-1",
    });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [
        { chain: "Arbitrum", asset: "USDC", usd: 50 },
        { chain: "Base", asset: "ETH", usd: 25 },
      ],
    });

    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });

    expect(recovered.agent.status).toBe("retired");
    expect(recovered.agent.publicStatus).toBe("retired");
    expect(recovered.agent.retiredAt).toBe(FIXED_NOW.toISOString());
    expect(recovered.retirement.reconciliationState).toBe("complete");
    expect(recovered.retirement.transferLeg?.status).toBe("complete");
    expect(recovered.retirement.transferLeg?.destination).toBe(RETURN_ADDRESS);
    expect(
      recovered.retirement.conversionLegs.some(
        (leg) => leg.status === "complete" && leg.fromAsset === "eth",
      ),
    ).toBe(true);
    expect(ua.withdrawalRecords.at(-1)?.request.destination).toBe(
      RETURN_ADDRESS,
    );
    expect(auditStore.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "retirement_started",
        "recovery_attempted",
        "retirement_completed",
      ]),
    );

    // One-agent slot released — a new agent can be created.
    const second = await createPendingAgent(
      store,
      OWNER,
      {
        handle: "retire-scout-2",
        returnAddress: RETURN_ADDRESS,
        maxTradeUsd: 10,
        spendBudgetUsd: 50,
        actionPolicy: { trade: true, back: true, publish: true },
      },
      {
        now: () => FIXED_NOW,
        randomId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        randomCode: () => "second-agent-code",
      },
    );
    expect(second.agent.handle).toBe("retire-scout-2");
  });

  it("does not duplicate completed conversion or transfer legs on retry", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [{ chain: "Arbitrum", asset: "USDC", usd: 20 }],
    });

    const first = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(first.retirement.reconciliationState).toBe("complete");
    const withdrawalCount = ua.withdrawalRecords.length;

    const second = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: first.agent,
      retirementId: first.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(second.retirement.reconciliationState).toBe("complete");
    expect(ua.withdrawalRecords.length).toBe(withdrawalCount);
  });

  it("records dust below $1 and still completes", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [{ chain: "Arbitrum", asset: "ARB", usd: 0.4 }],
    });

    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });

    expect(recovered.agent.status).toBe("retired");
    expect(recovered.retirement.dustUsd).toBeGreaterThan(0);
    expect(recovered.retirement.dustUsd).toBeLessThan(
      RETIREMENT_DUST_THRESHOLD_USD,
    );
    expect(
      recovered.retirement.residualHoldings.every(
        (holding) => holding.unrecoverableDust,
      ),
    ).toBe(true);
  });

  it("keeps retiring with needs_attention when residual value is at least $1", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [{ chain: "Arbitrum", asset: "ARB", usd: 5 }],
    });

    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });

    expect(recovered.agent.status).toBe("retiring");
    expect(recovered.retirement.reconciliationState).toBe("needs_attention");
    expect(recovered.retirement.lastError).toMatch(/residual value/i);

    // Operator retry remains available; still blocked while residue remains.
    const retried = await retryRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(retried.agent.status).toBe("retiring");
    expect(retried.retirement.reconciliationState).toBe("needs_attention");
  });

  it("rejects re-enable after retirement starts or completes", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    await expect(
      enableAgent({
        store,
        auditStore,
        ownerUserId: OWNER.userId,
        agentId: started.agent.agentId,
      }),
    ).rejects.toMatchObject({ code: "lifecycle_blocked" });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [],
    });
    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(recovered.agent.status).toBe("retired");

    // Completed retirement releases the non-retired slot, so enable cannot
    // target the retired identity (and must not revive it).
    await expect(
      enableAgent({
        store,
        auditStore,
        ownerUserId: OWNER.userId,
        agentId: recovered.agent.agentId,
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
  });

  it("never sends recovery to a destination other than the locked return address", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [{ chain: "Arbitrum", asset: "USDC", usd: 12 }],
    });
    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });

    expect(recovered.retirement.transferLeg?.destination).toBe(RETURN_ADDRESS);
    for (const record of ua.withdrawalRecords) {
      expect(record.request.destination).toBe(RETURN_ADDRESS);
      expect(record.request.asset).toBe("usdc");
      expect(record.request.destChain).toBe("Arbitrum");
    }
  });

  it("rejects concurrent recovery claims", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const claimed = await retirementStore.claimRecovery({
      retirementId: started.retirement.retirementId,
      claimToken: "claim-a",
      now: FIXED_NOW,
    });
    expect(claimed?.recoveryClaimToken).toBe("claim-a");

    const blocked = await retirementStore.claimRecovery({
      retirementId: started.retirement.retirementId,
      claimToken: "claim-b",
      now: FIXED_NOW,
    });
    expect(blocked).toBeNull();

    await expect(
      executeRetirementRecovery({
        store,
        retirementStore,
        auditStore,
        agent: started.agent,
        retirementId: started.retirement.retirementId,
        ua: new MockUAClient({
          mutateSourcesOnExecute: true,
          sources: [{ chain: "Arbitrum", asset: "USDC", usd: 10 }],
        }),
        signers: mockTradeSigners,
        allowMock: true,
      now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "lifecycle_blocked" });
  });

  it("rejects recovery for a retirementId that does not belong to the agent", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const foreign = {
      ...started.agent,
      agentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ownerUserId: "did:privy:other",
    };

    expect(() =>
      assertRetirementOwnership(started.retirement, foreign),
    ).toThrow(AgentProvisioningError);

    await expect(
      executeRetirementRecovery({
        store,
        retirementStore,
        auditStore,
        agent: foreign,
        retirementId: started.retirement.retirementId,
        ua: new MockUAClient({ sources: [] }),
        signers: mockTradeSigners,
        allowMock: true,
      now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
  });

  it("persists completed conversion legs before a later failure so retry skips them", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    let withdrawals = 0;
    const ua = new MockUAClient({
      mutateSourcesOnExecute: true,
      sources: [
        { chain: "Base", asset: "ETH", usd: 20 },
        { chain: "Arbitrum", asset: "USDC", usd: 5 },
      ],
    });
    const originalWithdraw = ua.executeWithdrawal.bind(ua);
    ua.executeWithdrawal = async (params) => {
      withdrawals += 1;
      if (withdrawals === 1) {
        throw new Error("simulated transfer failure");
      }
      return originalWithdraw(params);
    };

    const first = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(first.retirement.reconciliationState).toBe("needs_attention");
    expect(
      first.retirement.conversionLegs.some((leg) => leg.status === "complete"),
    ).toBe(true);

    const persisted = await retirementStore.get(started.retirement.retirementId);
    expect(
      persisted?.conversionLegs.every(
        (leg) => leg.status === "complete" || leg.status === "skipped",
      ),
    ).toBe(true);

    const second = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(second.retirement.reconciliationState).toBe("complete");
    expect(second.agent.status).toBe("retired");
  });

  it("does not complete reconcile from an empty balance without a terminal transfer leg", async () => {
    const store = new MemoryAgentProvisioningStore();
    const retirementStore = new MemoryAgentRetirementStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    const started = await startRetirement({
      store,
      retirementStore,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    const reconciled = await reconcileRetirementResiduals({
      store,
      retirementStore,
      auditStore,
      retirementId: started.retirement.retirementId,
      ua: new MockUAClient({ sources: [] }),
      now: FIXED_NOW,
    });
    expect(reconciled.reconciliationState).toBe("needs_attention");
    expect(reconciled.lastError).toMatch(/terminal/i);
    expect(
      (await store.findNonRetiredByOwner(OWNER.userId))?.status,
    ).toBe("retiring");
  });
});

describe("canUseMockRetirementRecovery", () => {
  it("allows mock recovery in test and fails closed without explicit allow in production-like flags", () => {
    expect(canUseMockRetirementRecovery()).toBe(true);
    expect(canUseMockRetirementRecovery({ allowMock: true })).toBe(true);
  });
});

describe("particle fail-closed recovery", () => {
  it("refuses in-process recovery when Particle is configured and allowMock is unset", async () => {
    const previous = {
      projectId: process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID,
      clientKey: process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY,
      appId: process.env.NEXT_PUBLIC_PARTICLE_APP_ID,
    };
    process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID = "test-project";
    process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY = "test-client";
    process.env.NEXT_PUBLIC_PARTICLE_APP_ID = "test-app";

    try {
      const store = new MemoryAgentProvisioningStore();
      const retirementStore = new MemoryAgentRetirementStore();
      const auditStore = new MemoryAgentAuditStore();
      const permitStore = new MemoryAgentPermitStore();
      const spendLedger = new MemorySpendLedger();
      const agent = await seedActiveAgent(store);
      const started = await startRetirement({
        store,
        retirementStore,
        auditStore,
        permitStore,
        spendLedger,
        ownerUserId: OWNER.userId,
        agentId: agent.agentId,
        now: FIXED_NOW,
      });

      await expect(
        executeRetirementRecovery({
          store,
          retirementStore,
          auditStore,
          agent: started.agent,
          retirementId: started.retirement.retirementId,
          ua: new MockUAClient({ sources: [] }),
          signers: mockTradeSigners,
          now: FIXED_NOW,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    } finally {
      if (previous.projectId === undefined) {
        delete process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
      } else {
        process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID = previous.projectId;
      }
      if (previous.clientKey === undefined) {
        delete process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
      } else {
        process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY = previous.clientKey;
      }
      if (previous.appId === undefined) {
        delete process.env.NEXT_PUBLIC_PARTICLE_APP_ID;
      } else {
        process.env.NEXT_PUBLIC_PARTICLE_APP_ID = previous.appId;
      }
    }
  });
});
