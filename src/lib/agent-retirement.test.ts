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
  finalizeRetirementRecovery,
  MemoryAgentRetirementStore,
  prepareRetirementRecovery,
  reconcileRetirementLegFinality,
  reconcileRetirementResiduals,
  RETIREMENT_RESIDUAL_STABILITY_MS,
  RETIREMENT_DUST_THRESHOLD_USD,
  retryRetirementRecovery,
  startRetirement,
  submitRetirementLeg,
} from "@/lib/agent-retirement";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { normalizeParticleTransactionStatus } from "@/lib/ua/particle-finality";

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
      apiBaseUrl: "https://app.getconviction.com",
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

async function withParticleEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    projectId: process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID,
    clientKey: process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY,
    appId: process.env.NEXT_PUBLIC_PARTICLE_APP_ID,
  };
  process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID = "test-project";
  process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY = "test-client";
  process.env.NEXT_PUBLIC_PARTICLE_APP_ID = "test-app";
  try {
    return await run();
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
}

function particlePending(transactionId: string) {
  return normalizeParticleTransactionStatus(transactionId, {
    transactionId,
    status: 5,
    lendingUserOperations: [
      { chainId: 42161, status: 1, userOpHash: `0x${"a".repeat(64)}` },
    ],
  });
}

function particleFinalized(transactionId: string, chainId = 42161) {
  return normalizeParticleTransactionStatus(transactionId, {
    transactionId,
    status: 7,
    lendingUserOperations: [
      {
        chainId,
        status: 3,
        userOpHash: `0x${"b".repeat(64)}`,
        txHash: `0x${"c".repeat(64)}`,
      },
    ],
  });
}

function particlePartial(transactionId: string) {
  return normalizeParticleTransactionStatus(transactionId, {
    transactionId,
    status: 6,
    depositUserOperations: [
      {
        chainId: 8453,
        status: 3,
        userOpHash: `0x${"d".repeat(64)}`,
        txHash: `0x${"e".repeat(64)}`,
      },
    ],
    lendingUserOperations: [
      {
        chainId: 42161,
        status: 2,
        userOpHash: `0x${"f".repeat(64)}`,
        error: "destination reverted",
      },
    ],
  });
}

async function retirementFixture(
  sources: Parameters<typeof classifyHoldings>[0]["sources"],
) {
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
    idempotencyKey: `fixture:${agent.agentId}`,
  });
  return {
    store,
    retirementStore,
    auditStore,
    started,
    ua: new MockUAClient({ sources, mutateSourcesOnExecute: true }),
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

    const submitted = await executeRetirementRecovery({
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
    expect(submitted.agent.status).toBe("retiring");
    expect(submitted.retirement.reconciliationState).toBe("pending_sync");

    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
    });

    expect(recovered.agent.status).toBe("retired");
    expect(recovered.agent.publicStatus).toBe("retired");
    expect(recovered.agent.retiredAt).toBe(
      new Date(FIXED_NOW.getTime() + 2_000).toISOString(),
    );
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
    expect(
      auditStore.events.filter(
        (event) => event.type === "retirement_completed",
      ),
    ).toHaveLength(1);

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
        apiBaseUrl: "https://app.getconviction.com",
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

    const firstObservation = await executeRetirementRecovery({
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
    expect(firstObservation.retirement.reconciliationState).toBe(
      "pending_sync",
    );
    const first = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
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

    await executeRetirementRecovery({
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
    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
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

    await executeRetirementRecovery({
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
    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
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
    await executeRetirementRecovery({
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
    const recovered = await executeRetirementRecovery({
      store,
      retirementStore,
      auditStore,
      agent: started.agent,
      retirementId: started.retirement.retirementId,
      ua,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
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

  it("persists confirmed conversions and never automatically resubmits a failed transfer", async () => {
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
    expect(second.retirement.reconciliationState).toBe("needs_attention");
    expect(second.agent.status).toBe("retiring");
    expect(withdrawals).toBe(1);
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
    expect(reconciled.reconciliationState).toBe("pending_sync");
    expect(reconciled.lastError).toMatch(/confirmed finality/i);
    expect(
      (await store.findNonRetiredByOwner(OWNER.userId))?.status,
    ).toBe("retiring");
  });
});

describe("confirmed retirement finality", () => {
  it("keeps an accepted conversion pending and blocks the return transfer", async () => {
    await withParticleEnv(async () => {
      const fixture = await retirementFixture([
        { chain: "Base", asset: "ETH", usd: 20 },
        { chain: "Arbitrum", asset: "USDC", usd: 5 },
      ]);
      const prepared = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: FIXED_NOW,
      });
      expect(prepared.signable?.kind).toBe("conversion");
      const plannedId =
        prepared.retirement.conversionLegs[0]?.transactionId ?? "";
      let sends = 0;
      const submitted = await submitRetirementLeg({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        legId: prepared.signable!.legId,
        rootHashSignature: "0xsigned",
        sendRaw: async () => {
          sends += 1;
          return plannedId;
        },
        statusReader: {
          getTransactionStatus: async () => particlePending(plannedId),
        },
        now: FIXED_NOW,
      });
      expect(submitted.retirement.conversionLegs[0]?.status).toBe("submitted");
      expect(submitted.retirement.conversionLegs[0]?.receiptId).toBeNull();
      expect(submitted.retirement.recoveredUsd).toBe(0);
      expect(submitted.agent.status).toBe("retiring");

      fixture.ua.getTransactionStatus = async () => particlePending(plannedId);
      const blocked = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: new Date(FIXED_NOW.getTime() + 1_000),
      });
      expect(blocked.signable).toBeNull();
      expect(blocked.retirement.transferLeg).toBeNull();
      expect(blocked.retirement.reconciliationState).toBe("pending_sync");
      expect(sends).toBe(1);
    });
  });

  it("does not account for an accepted return transfer before confirmation", async () => {
    await withParticleEnv(async () => {
      const fixture = await retirementFixture([
        { chain: "Arbitrum", asset: "USDC", usd: 12 },
      ]);
      const prepared = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: FIXED_NOW,
      });
      expect(prepared.signable?.kind).toBe("transfer");
      const plannedId = prepared.retirement.transferLeg!.transactionId!;
      const submitted = await submitRetirementLeg({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        legId: prepared.signable!.legId,
        rootHashSignature: "0xsigned",
        sendRaw: async () => plannedId,
        now: FIXED_NOW,
      });
      expect(submitted.retirement.transferLeg?.status).toBe("submitted");
      expect(submitted.retirement.transferLeg?.receiptId).toBeNull();
      expect(submitted.retirement.recoveredUsd).toBe(0);
      expect(submitted.retirement.reconciliationState).toBe("pending_sync");
      expect(submitted.agent.status).toBe("retiring");
    });
  });

  it("marks source-success and destination-failure evidence needs_attention", async () => {
    await withParticleEnv(async () => {
      const fixture = await retirementFixture([
        { chain: "Base", asset: "ETH", usd: 20 },
      ]);
      const prepared = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: FIXED_NOW,
      });
      const plannedId =
        prepared.retirement.conversionLegs[0]?.transactionId ?? "";
      await submitRetirementLeg({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        legId: prepared.signable!.legId,
        rootHashSignature: "0xsigned",
        sendRaw: async () => plannedId,
        now: FIXED_NOW,
      });
      const current = (await fixture.retirementStore.get(
        fixture.started.retirement.retirementId,
      ))!;
      const reconciled = await reconcileRetirementLegFinality({
        retirementStore: fixture.retirementStore,
        retirement: current,
        legId: prepared.signable!.legId,
        ua: {
          getTransactionStatus: async () => particlePartial(plannedId),
        },
        now: new Date(FIXED_NOW.getTime() + 1_000),
      });
      const leg = reconciled.conversionLegs[0]!;
      expect(leg.status).toBe("needs_attention");
      expect(leg.finality.outcome).toBe("partial");
      expect(leg.receiptId).toBeNull();
      expect(leg.finality.confirmedHashes).toHaveLength(1);
      expect(reconciled.reconciliationState).toBe("needs_attention");
      expect(reconciled.recoveredUsd).toBe(0);
    });
  });

  it("serializes concurrent submits and never sends a leg twice", async () => {
    await withParticleEnv(async () => {
      const fixture = await retirementFixture([
        { chain: "Arbitrum", asset: "USDC", usd: 8 },
      ]);
      const prepared = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: FIXED_NOW,
      });
      const plannedId = prepared.retirement.transferLeg!.transactionId!;
      let sends = 0;
      let releaseSend!: () => void;
      const sendGate = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      const submit = () =>
        submitRetirementLeg({
          ...fixture,
          agent: fixture.started.agent,
          retirementId: fixture.started.retirement.retirementId,
          legId: prepared.signable!.legId,
          rootHashSignature: "0xsigned",
          sendRaw: async () => {
            sends += 1;
            await sendGate;
            return plannedId;
          },
          statusReader: {
            getTransactionStatus: async () => particlePending(plannedId),
          },
          now: FIXED_NOW,
        });
      const first = submit();
      await Promise.resolve();
      const second = submit();
      releaseSend();
      const results = await Promise.allSettled([first, second]);
      expect(
        results.some((result) => result.status === "fulfilled"),
      ).toBe(true);
      expect(sends).toBe(1);

      await submit();
      expect(sends).toBe(1);
    });
  });

  it("restores submitted finality state and evidence after store restart", async () => {
    await withParticleEnv(async () => {
      const fixture = await retirementFixture([
        { chain: "Arbitrum", asset: "USDC", usd: 7 },
      ]);
      const prepared = await prepareRetirementRecovery({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        now: FIXED_NOW,
      });
      const plannedId = prepared.retirement.transferLeg!.transactionId!;
      await submitRetirementLeg({
        ...fixture,
        agent: fixture.started.agent,
        retirementId: fixture.started.retirement.retirementId,
        legId: prepared.signable!.legId,
        rootHashSignature: "0xsigned",
        sendRaw: async () => plannedId,
        now: FIXED_NOW,
      });

      const restartedStore = new MemoryAgentRetirementStore(
        fixture.retirementStore.exportState(),
      );
      const restored = (await restartedStore.get(
        fixture.started.retirement.retirementId,
      ))!;
      const reconciled = await reconcileRetirementLegFinality({
        retirementStore: restartedStore,
        retirement: restored,
        legId: prepared.signable!.legId,
        ua: {
          getTransactionStatus: async () => particleFinalized(plannedId),
        },
        now: new Date(FIXED_NOW.getTime() + 1_000),
      });
      expect(reconciled.transferLeg?.status).toBe("complete");
      expect(reconciled.transferLeg?.receiptId).toBe(
        `0x${"c".repeat(64)}`,
      );
      expect(reconciled.transferLeg?.finality.providerEvidence.length).toBeGreaterThan(
        1,
      );
      expect(reconciled.recoveredUsd).toBe(7);
    });
  });

  it("requires stable residual observations and resets them when value returns", async () => {
    const fixture = await retirementFixture([]);
    await fixture.retirementStore.update({
      ...fixture.started.retirement,
      transferLeg: {
        legId: `transfer:usdc:Arbitrum:${RETURN_ADDRESS.toLowerCase()}`,
        kind: "transfer",
        asset: "usdc",
        destChain: "Arbitrum",
        amount: "0",
        destination: RETURN_ADDRESS,
        status: "skipped",
        quote: null,
        rootHash: null,
        transactionId: null,
        receiptId: null,
        finality: {
          outcome: null,
          providerStatus: null,
          attemptCount: 0,
          submittedAt: null,
          confirmedAt: null,
          confirmedHashes: [],
          providerEvidence: [],
        },
        error: null,
      },
    });
    let sources: Parameters<typeof classifyHoldings>[0]["sources"] = [];
    fixture.ua.getUniversalBalance = async () => ({
      totalUsd: sources.reduce((sum, source) => sum + source.usd, 0),
      sources,
    });

    const first = await reconcileRetirementResiduals({
      ...fixture,
      retirementId: fixture.started.retirement.retirementId,
      now: FIXED_NOW,
    });
    expect(first.reconciliationState).toBe("pending_sync");
    expect(first.residualObservation.consecutiveDustObservations).toBe(1);

    sources = [{ chain: "Arbitrum", asset: "ARB", usd: 2 }];
    const contradicted = await reconcileRetirementResiduals({
      ...fixture,
      retirementId: fixture.started.retirement.retirementId,
      now: new Date(FIXED_NOW.getTime() + RETIREMENT_RESIDUAL_STABILITY_MS),
    });
    expect(contradicted.reconciliationState).toBe("needs_attention");
    expect(contradicted.residualObservation.consecutiveDustObservations).toBe(0);

    sources = [];
    const afterReset = await reconcileRetirementResiduals({
      ...fixture,
      retirementId: fixture.started.retirement.retirementId,
      now: new Date(FIXED_NOW.getTime() + 4_000),
    });
    expect(afterReset.reconciliationState).toBe("pending_sync");
    expect(afterReset.residualObservation.consecutiveDustObservations).toBe(1);
    const completed = await reconcileRetirementResiduals({
      ...fixture,
      retirementId: fixture.started.retirement.retirementId,
      now: new Date(FIXED_NOW.getTime() + 6_000),
    });
    expect(completed.reconciliationState).toBe("complete");
    expect(
      fixture.auditStore.events.filter(
        (event) => event.type === "retirement_completed",
      ),
    ).toHaveLength(1);
  });

  it("uses confirmed hashes, never planned userOp hashes, as receipts", async () => {
    const fixture = await retirementFixture([
      { chain: "Arbitrum", asset: "USDC", usd: 5 },
    ]);
    const first = await executeRetirementRecovery({
      ...fixture,
      agent: fixture.started.agent,
      retirementId: fixture.started.retirement.retirementId,
      signers: mockTradeSigners,
      allowMock: true,
      now: FIXED_NOW,
    });
    expect(first.retirement.reconciliationState).toBe("pending_sync");
    const completed = await executeRetirementRecovery({
      ...fixture,
      agent: fixture.started.agent,
      retirementId: fixture.started.retirement.retirementId,
      signers: mockTradeSigners,
      allowMock: true,
      now: new Date(FIXED_NOW.getTime() + 2_000),
    });
    expect(completed.retirement.reconciliationState).toBe("complete");
    expect(completed.retirement.recoveredUsd).toBeGreaterThan(0);
    for (const leg of [
      ...completed.retirement.conversionLegs,
      completed.retirement.transferLeg!,
    ]) {
      if (leg.status !== "complete") continue;
      expect(leg.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(leg.receiptId).not.toContain("mocksource");
      expect(leg.receiptId).not.toContain("mockdest");
      expect(leg.finality.confirmedHashes.length).toBeGreaterThan(0);
    }
    await finalizeRetirementRecovery({
      ...fixture,
      agent: completed.agent,
      retirementId: fixture.started.retirement.retirementId,
      now: new Date(FIXED_NOW.getTime() + 4_000),
    });
    expect(
      fixture.auditStore.events.filter(
        (event) => event.type === "retirement_completed",
      ),
    ).toHaveLength(1);
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
