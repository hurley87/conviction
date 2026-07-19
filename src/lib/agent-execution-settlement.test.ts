import { beforeEach, describe, expect, it } from "vitest";

import { getAgentAuditStore, resetAgentAuditStoreForTests } from "@/lib/agent-audit";
import {
  MemoryAgentIdempotencyStore,
  MemoryAgentReceiptPersist,
  MemorySpendLedger,
} from "@/lib/agent-execute";
import {
  createPreSubmissionExecution,
} from "@/lib/agent-execution-reconciliation";
import {
  MemoryExecutionFinalityStore,
  type ExecutionFinalityRecord,
  type ExecutionOutcome,
} from "@/lib/agent-execution-finality";
import {
  MemoryAgentPermitStore,
  settleExecutionFinality,
  submitSignedTradeExecution,
  type ExecutionPermitRecord,
} from "@/lib/agent-permit";
import { MemoryAgentConvictionPersist, publishAgentConviction } from "@/lib/agent-publish";
import { MemoryAgentQuoteStore } from "@/lib/agent-quote";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import { MemoryAgentTradeReceiptStore } from "@/lib/agent-trade-receipt";
import { MemoryAgentBackRecordStore } from "@/lib/agent-back";
import {
  getAgentNotificationStore,
  resetAgentNotificationStoreForTests,
} from "@/lib/agent-notifications";

const NOW = new Date("2026-07-19T17:00:00.000Z");
const AGENT: OwnedAgent = {
  agentId: "10000000-0000-4000-8000-000000000083",
  ownerUserId: "did:privy:issue-83",
  handle: "finality-scout",
  authorKind: "agent",
  operatorHandle: "operator",
  address: "0x1111111111111111111111111111111111111111",
  returnAddress: "0x2222222222222222222222222222222222222222",
  status: "active",
  publicStatus: "active",
  actionPolicy: { trade: true, back: true, publish: true },
  maxTradeUsd: 25,
  spendBudgetUsd: 100,
  lifetimeSpendUsd: 0,
  fundingReady: true,
  setupVerifiedAt: NOW.toISOString(),
  createdAt: NOW.toISOString(),
  disabledAt: null,
  retirementStartedAt: null,
  retiredAt: null,
};

const PERMIT: ExecutionPermitRecord = {
  permitId: "20000000-0000-4000-8000-000000000083",
  agentId: AGENT.agentId,
  leaseId: "lease-83",
  quoteId: "30000000-0000-4000-8000-000000000083",
  quoteFingerprint: "quote-fingerprint-83",
  idempotencyKey: "idem-finality-83",
  action: "trade",
  dollarsIn: 20,
  floorUsd: 19,
  intent: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
  sizeUsd: 20,
  agreedQuote: {
    dollarsIn: 20,
    dollarsOut: 19.5,
    feeUsd: 0.5,
    etaSeconds: 60,
    floorUsd: 19,
    sourceChain: "Base",
    destChain: "Arbitrum",
    toAsset: "eth",
    receivedSymbol: "ETH",
    transactionId: "particle-83",
    rawTransaction: {},
  },
  rawTransaction: {
    transactionId: "particle-83",
    rootHash: `0x${"a".repeat(64)}`,
    userOps: [
      { chainId: 8453, userOpHash: `0x${"9".repeat(64)}` },
      { chainId: 42161, userOpHash: `0x${"8".repeat(64)}` },
    ],
  },
  issuedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
  status: "pending",
};

async function fixture(outcome: ExecutionOutcome) {
  const executionStore = new MemoryExecutionFinalityStore();
  const initial = await executionStore.create(
    createPreSubmissionExecution({
      executionId: "40000000-0000-4000-8000-000000000083",
      agentId: AGENT.agentId,
      permitId: PERMIT.permitId,
      quoteId: PERMIT.quoteId,
      idempotencyKey: PERMIT.idempotencyKey,
      rawTransaction: PERMIT.rawTransaction as never,
      createdAt: NOW.toISOString(),
    }),
  );
  const confirmedSource = `0x${"1".repeat(64)}`;
  const confirmedDestination = `0x${"2".repeat(64)}`;
  if (outcome === "pending") {
    return stores(initial, executionStore);
  }
  const legs = initial.legs.map((leg, index) => ({
    ...leg,
    status:
      outcome === "finalized"
        ? ("finalized" as const)
        : outcome === "failed"
          ? ("failed" as const)
          : outcome === "needs_attention"
            ? ("needs_attention" as const)
          : index === 0
            ? ("finalized" as const)
            : ("failed" as const),
    confirmedHash:
      outcome === "finalized"
        ? index === 0
          ? confirmedSource
          : confirmedDestination
        : outcome === "partial" && index === 0
          ? confirmedSource
          : null,
    attemptCount: 1,
    lastProviderStatus: outcome.toUpperCase(),
    confirmedAt:
      outcome === "finalized" || (outcome === "partial" && index === 0)
        ? NOW.toISOString()
        : null,
  }));
  const record = await executionStore.transition({
    executionId: initial.executionId,
    expectedVersion: initial.version,
    from: initial.outcome,
    to: outcome,
    updatedAt: NOW.toISOString(),
    patch: {
      legs,
      attemptCount: 1,
      lastProviderStatus: outcome.toUpperCase(),
      ...(outcome === "needs_attention"
        ? {
            operatorRecovery: {
              summary: "manual recovery required",
              affectedLegIds: legs.map((leg) => leg.legId),
              steps: ["Inspect confirmed provider evidence."],
            },
          }
        : {}),
    },
  });
  if (!record) throw new Error("expected terminal execution");

  return stores(record, executionStore);
}

async function stores(
  record: ExecutionFinalityRecord,
  executionStore: MemoryExecutionFinalityStore,
) {
  const permitStore = new MemoryAgentPermitStore();
  await permitStore.save(PERMIT);
  const spendLedger = new MemorySpendLedger();
  spendLedger.tryReserve({
    agentId: AGENT.agentId,
    dollarsIn: PERMIT.dollarsIn,
    maxTradeUsd: AGENT.maxTradeUsd,
    spendBudgetUsd: AGENT.spendBudgetUsd,
    lifetimeSpendUsd: AGENT.lifetimeSpendUsd,
  });
  return {
    record,
    executionStore,
    permitStore,
    spendLedger,
    idempotencyStore: new MemoryAgentIdempotencyStore(),
    receipts: new MemoryAgentReceiptPersist(),
    tradeReceipts: new MemoryAgentTradeReceiptStore(),
    quoteStore: new MemoryAgentQuoteStore(),
  };
}

function settlementOptions(
  state: Awaited<ReturnType<typeof fixture>>,
  onSpend: (dollarsIn: number) => void | Promise<void>,
) {
  return {
    agent: AGENT,
    record: state.record,
    permitStore: state.permitStore,
    idempotencyStore: state.idempotencyStore,
    receipts: state.receipts,
    quoteStore: state.quoteStore,
    tradeReceipts: state.tradeReceipts,
    executionFinalityStore: state.executionStore,
    spendLedger: state.spendLedger,
    onSpend,
    now: () => NOW,
  };
}

describe("confirmed execution settlement", () => {
  beforeEach(() => {
    resetAgentAuditStoreForTests();
    resetAgentNotificationStoreForTests();
  });

  it("settles finalized legs once and never uses planned userOp hashes", async () => {
    const state = await fixture("finalized");
    let spendSettlements = 0;
    const options = settlementOptions(state, () => {
      spendSettlements += 1;
    });

    const concurrent = await Promise.all([
      settleExecutionFinality(options),
      settleExecutionFinality(options),
      settleExecutionFinality(options),
    ]);
    const retryRecord = (await state.executionStore.get(state.record.executionId))!;
    const retry = await settleExecutionFinality({ ...options, record: retryRecord });

    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(retry).toMatchObject({ ok: true, receiptId: state.record.executionId });
    expect(spendSettlements).toBe(1);
    expect(state.spendLedger.reservedUsd(AGENT.agentId)).toBe(0);
    expect((await state.permitStore.get(PERMIT.permitId))?.status).toBe("consumed");
    if (!retry.ok) throw new Error("expected finalized retry");
    expect(retry.receipt.legs.map((leg) => leg.txHash)).toEqual([
      `0x${"1".repeat(64)}`,
      `0x${"2".repeat(64)}`,
    ]);
    expect(JSON.stringify(retry.receipt)).not.toContain(`0x${"9".repeat(64)}`);
    expect(await state.tradeReceipts.get(retry.receiptId)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const events = await getAgentAuditStore().listByAgent(AGENT.agentId);
    expect(events.filter((event) => event.type === "execute_result")).toHaveLength(1);
    const notifications =
      await getAgentNotificationStore().listByOwner(AGENT.ownerUserId);
    expect(
      notifications.filter((item) => item.kind === "trade_success"),
    ).toHaveLength(1);
  });

  it("returns the same durable finalized success on authenticated idempotent retries", async () => {
    const state = await fixture("finalized");
    let sends = 0;
    let spends = 0;
    const submit = () =>
      submitSignedTradeExecution({
        agent: AGENT,
        input: {
          permitId: PERMIT.permitId,
          idempotencyKey: PERMIT.idempotencyKey,
          leaseId: PERMIT.leaseId,
          rootHashSignature: "",
        },
        permitStore: state.permitStore,
        idempotencyStore: state.idempotencyStore,
        receipts: state.receipts,
        quoteStore: state.quoteStore,
        tradeReceipts: state.tradeReceipts,
        executionFinalityStore: state.executionStore,
        executionWorkflow: {
          async start() {
            throw new Error("finalized execution must not restart workflow");
          },
        },
        spendLedger: state.spendLedger,
        onSpend: () => {
          spends += 1;
        },
        activeLeaseId: PERMIT.leaseId,
        now: () => NOW,
        send: async () => {
          sends += 1;
          throw new Error("finalized execution must not resubmit");
        },
      });

    const first = await submit();
    const retry = await submit();
    expect(first).toMatchObject({ ok: true, receiptId: state.record.executionId });
    expect(retry).toEqual(first);
    expect(sends).toBe(0);
    expect(spends).toBe(1);
  });

  it("emits back success only after provider-finalized settlement", async () => {
    const state = await fixture("finalized");
    await state.permitStore.save({
      ...PERMIT,
      action: "back",
      entryId: "entry-83",
    });
    const result = await settleExecutionFinality({
      ...settlementOptions(state, () => undefined),
      backStore: new MemoryAgentBackRecordStore(),
      startBackWorkflow: {
        async start() {
          return { runId: "back-attribution-83" };
        },
      },
    });
    expect(result).toMatchObject({ ok: true, action: "back" });
    await Promise.resolve();
    await Promise.resolve();
    const notifications =
      await getAgentNotificationStore().listByOwner(AGENT.ownerUserId);
    expect(
      notifications.filter((item) => item.kind === "back_success"),
    ).toHaveLength(1);
  });

  it("keeps partial execution non-success, unpublished, and reserved", async () => {
    const state = await fixture("partial");
    let spends = 0;
    const result = await settleExecutionFinality(
      settlementOptions(state, () => {
        spends += 1;
      }),
    );
    await settleExecutionFinality(
      settlementOptions(state, () => {
        spends += 1;
      }),
    );
    expect(result).toMatchObject({ ok: false, execution: { outcome: "partial" } });
    expect(spends).toBe(0);
    expect(state.spendLedger.reservedUsd(AGENT.agentId)).toBe(PERMIT.dollarsIn);
    expect(await state.tradeReceipts.get(state.record.executionId)).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    const notifications =
      await getAgentNotificationStore().listByOwner(AGENT.ownerUserId);
    expect(
      notifications.filter(
        (item) =>
          item.kind === "trade_success" || item.kind === "back_success",
      ),
    ).toHaveLength(0);
    const attention = notifications.filter(
      (item) => item.kind === "reconciliation_needs_attention",
    );
    expect(attention).toHaveLength(1);
    expect(attention[0]?.body).toContain("particle-83");
    expect(attention[0]?.body).toContain("destination");
    expect(attention[0]?.body).toContain("PARTIAL");

    const published = await publishAgentConviction({
      agent: AGENT,
      body: { receiptId: state.record.executionId, thesis: "must not publish" },
      tradeReceipts: state.tradeReceipts,
      convictions: new MemoryAgentConvictionPersist(),
      leaseId: "lease-83",
      activeLeaseId: "lease-83",
      checkRouter: async () => ({ status: "routable" }),
      now: () => NOW,
    });
    expect(published).toMatchObject({ ok: false });
  });

  it("releases a confirmed total failure once and remains non-success", async () => {
    const state = await fixture("failed");
    let spends = 0;
    const options = settlementOptions(state, () => {
      spends += 1;
    });
    const first = await settleExecutionFinality(options);
    const latest = (await state.executionStore.get(state.record.executionId))!;
    const second = await settleExecutionFinality({ ...options, record: latest });

    expect(first).toMatchObject({ ok: false, execution: { outcome: "failed" } });
    expect(second).toMatchObject({ ok: false, execution: { outcome: "failed" } });
    expect(spends).toBe(0);
    expect(state.spendLedger.reservedUsd(AGENT.agentId)).toBe(0);
    expect((await state.permitStore.get(PERMIT.permitId))?.status).toBe("released");
    expect(await state.receipts.get(state.record.executionId)).toBeNull();
  });

  it.each(["pending", "partial", "failed", "needs_attention"] as const)(
    "does not create publish or back attribution records for %s execution",
    async (outcome) => {
      const state = await fixture(outcome);
      await state.permitStore.save({
        ...PERMIT,
        action: "back",
        entryId: "entry-83",
      });
      const backStore = new MemoryAgentBackRecordStore();
      let workflowStarts = 0;
      const result = await settleExecutionFinality({
        ...settlementOptions(state, () => undefined),
        backStore,
        startBackWorkflow: {
          async start() {
            workflowStarts += 1;
            return { runId: "must-not-start" };
          },
        },
      });

      expect(result.ok).toBe(false);
      expect(await state.tradeReceipts.get(state.record.executionId)).toBeNull();
      expect(await backStore.getByAgentId(AGENT.agentId)).toBeNull();
      expect(workflowStarts).toBe(0);
    },
  );
});
