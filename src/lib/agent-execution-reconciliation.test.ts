import { describe, expect, it } from "vitest";

import {
  createExecutionReconciler,
  createPreSubmissionExecution,
  runExecutionReconciliationRetries,
} from "@/lib/agent-execution-reconciliation";
import { MemoryExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import type { ParticleTransactionStatusRead } from "@/lib/ua/particle-finality";

const T0 = "2026-07-19T16:00:00.000Z";

function pendingRead(
  overrides: Partial<ParticleTransactionStatusRead> = {},
): ParticleTransactionStatusRead {
  return {
    transactionId: "particle-plan-83",
    providerStatus: "EXECUTION_PENDING",
    outcome: "pending",
    retrySafe: true,
    error: null,
    raw: { status: "EXECUTION_PENDING" },
    legs: [
      {
        legId: "source:8453:0",
        kind: "source",
        chainId: 8453,
        chainName: "Base",
        required: true,
        status: "pending",
        providerStatus: "PENDING",
        confirmedHash: null,
        explorerUrl: null,
        error: null,
        raw: { chainId: 8453, status: "PENDING" },
      },
      {
        legId: "destination:42161:0",
        kind: "destination",
        chainId: 42161,
        chainName: "Arbitrum",
        required: true,
        status: "pending",
        providerStatus: "PENDING",
        confirmedHash: null,
        explorerUrl: null,
        error: null,
        raw: { chainId: 42161, status: "PENDING" },
      },
    ],
    ...overrides,
  };
}

function finalizedRead(): ParticleTransactionStatusRead {
  return pendingRead({
    providerStatus: "FINISHED",
    outcome: "finalized",
    retrySafe: false,
    raw: { status: "FINISHED" },
    legs: pendingRead().legs.map((leg, index) => ({
      ...leg,
      status: "finalized",
      providerStatus: "COMPLETED",
      confirmedHash: `0x${String(index + 1).repeat(64)}`,
      raw: { chainId: leg.chainId, status: "COMPLETED" },
    })),
  });
}

async function seededStore(): Promise<MemoryExecutionFinalityStore> {
  const store = new MemoryExecutionFinalityStore();
  await store.create(
    createPreSubmissionExecution({
      executionId: "10000000-0000-4000-8000-000000000083",
      agentId: "20000000-0000-4000-8000-000000000083",
      permitId: "30000000-0000-4000-8000-000000000083",
      quoteId: "40000000-0000-4000-8000-000000000083",
      idempotencyKey: "execution-83",
      rawTransaction: {
        transactionId: "particle-plan-83",
        rootHash: `0x${"a".repeat(64)}`,
        userOps: [{ chainId: 8453 }, { chainId: 42161 }],
      },
      createdAt: T0,
    }),
  );
  return store;
}

describe("execution finality reconciliation", () => {
  it("persists pending reads before eventual confirmed success", async () => {
    const store = await seededStore();
    const reads = [pendingRead(), pendingRead(), finalizedRead()];
    let clock = 0;
    const reconciler = createExecutionReconciler({
      store,
      ua: {
        async getTransactionStatus() {
          return reads.shift()!;
        },
      },
      now: () => new Date(Date.parse(T0) + ++clock * 1_000),
    });

    expect(
      (
        await reconciler.reconcile(
          "10000000-0000-4000-8000-000000000083",
        )
      ).outcome,
    ).toBe("pending");
    const second = await reconciler.reconcile(
      "10000000-0000-4000-8000-000000000083",
    );
    expect(second).toMatchObject({ outcome: "pending", attemptCount: 2 });

    const finalized = await reconciler.reconcile(
      "10000000-0000-4000-8000-000000000083",
    );
    expect(finalized).toMatchObject({
      outcome: "finalized",
      attemptCount: 3,
      lastProviderStatus: "FINISHED",
    });
    expect(finalized.legs.every((leg) => leg.status === "finalized")).toBe(
      true,
    );
    expect(finalized.providerEvidence).toHaveLength(3);
  });

  it("escalates retry exhaustion to needs_attention with evidence", async () => {
    const store = await seededStore();
    const reconciler = createExecutionReconciler({
      store,
      ua: { getTransactionStatus: async () => pendingRead() },
      maxAttempts: 2,
      now: () => new Date(T0),
    });

    const exhausted = await runExecutionReconciliationRetries({
      executionId: "10000000-0000-4000-8000-000000000083",
      reconcile: reconciler,
    });
    expect(exhausted).toMatchObject({
      outcome: "needs_attention",
      attemptCount: 2,
      lastProviderStatus: "EXECUTION_PENDING",
    });
    expect(exhausted.operatorRecovery?.steps.join(" ")).toMatch(
      /never resubmit/i,
    );
    expect(exhausted.providerEvidence).toHaveLength(2);
  });

  it("preserves a confirmed source success plus destination failure as partial", async () => {
    const store = await seededStore();
    const partial = await createExecutionReconciler({
      store,
      ua: {
        getTransactionStatus: async () =>
          pendingRead({
            outcome: "partial",
            retrySafe: false,
            legs: pendingRead().legs.map((leg, index) => ({
              ...leg,
              status: index === 0 ? "finalized" : "failed",
              confirmedHash: index === 0 ? `0x${"3".repeat(64)}` : null,
              error: index === 0 ? null : "destination reverted",
            })),
          }),
      },
      now: () => new Date(T0),
    }).reconcile("10000000-0000-4000-8000-000000000083");

    expect(partial).toMatchObject({
      outcome: "partial",
      legs: [
        { status: "finalized", confirmedHash: `0x${"3".repeat(64)}` },
        { status: "failed", confirmedHash: null },
      ],
    });
  });

  it("records an unambiguous all-leg provider failure as failed", async () => {
    const store = await seededStore();
    const failed = await createExecutionReconciler({
      store,
      ua: {
        getTransactionStatus: async () =>
          pendingRead({
            outcome: "failed",
            retrySafe: false,
            legs: pendingRead().legs.map((leg) => ({
              ...leg,
              status: "failed",
              confirmedHash: null,
              error: "provider confirmed failure",
            })),
          }),
      },
      now: () => new Date(T0),
    }).reconcile("10000000-0000-4000-8000-000000000083");

    expect(failed.outcome).toBe("failed");
    expect(failed.legs.every((leg) => leg.status === "failed")).toBe(true);
  });

  it("continues from a durable repository snapshot after process restart", async () => {
    const firstStore = await seededStore();
    const firstReconciler = createExecutionReconciler({
      store: firstStore,
      ua: { getTransactionStatus: async () => pendingRead() },
      now: () => new Date(T0),
    });
    await firstReconciler.reconcile(
      "10000000-0000-4000-8000-000000000083",
    );

    const restartedStore = new MemoryExecutionFinalityStore(
      firstStore.exportState(),
    );
    const restarted = await createExecutionReconciler({
      store: restartedStore,
      ua: { getTransactionStatus: async () => finalizedRead() },
      now: () => new Date(Date.parse(T0) + 1_000),
    }).reconcile("10000000-0000-4000-8000-000000000083");

    expect(restarted).toMatchObject({
      executionId: "10000000-0000-4000-8000-000000000083",
      particleTransactionId: "particle-plan-83",
      outcome: "finalized",
      attemptCount: 2,
    });
  });

  it("has a read-only provider capability and cannot sign or submit", async () => {
    const store = await seededStore();
    let statusReads = 0;
    let forbiddenCalls = 0;
    const provider = {
      async getTransactionStatus() {
        statusReads += 1;
        return pendingRead();
      },
      async signRootHash() {
        forbiddenCalls += 1;
      },
      async sendTransaction() {
        forbiddenCalls += 1;
      },
    };

    await createExecutionReconciler({
      store,
      ua: provider,
      maxAttempts: 1,
      now: () => new Date(T0),
    }).reconcile("10000000-0000-4000-8000-000000000083");

    expect(statusReads).toBe(1);
    expect(forbiddenCalls).toBe(0);
  });
});
