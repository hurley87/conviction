import { describe, expect, it } from "vitest";

import {
  createExecutionFinalityRecord,
  type ExecutionFinalityRecord,
  type ExecutionLeg,
} from "@/lib/agent-execution-finality";
import { MemoryExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import {
  createExecutionReconciler,
} from "@/lib/agent-execution-reconciliation";
import {
  loadOperatorFinalityStatus,
  retirementStatusForOperator,
} from "@/lib/agent-operator-finality";
import { MemoryAgentQuoteStore } from "@/lib/agent-quote";
import {
  MemoryAgentRetirementStore,
  type AgentRetirementRecord,
} from "@/lib/agent-retirement";

const OWNER = "did:privy:operator-83";
const AGENT = "10000000-0000-4000-8000-000000000083";
const OTHER_AGENT = "10000000-0000-4000-8000-000000000084";
const NOW = "2026-07-19T18:00:00.000Z";

function legs(): ExecutionLeg[] {
  return [
    {
      legId: "source:8453:0",
      kind: "source",
      chainId: 8453,
      chainName: "Base",
      required: true,
      status: "pending",
      confirmedHash: null,
      attemptCount: 2,
      lastProviderStatus: "PENDING",
      lastError: null,
      submittedAt: NOW,
      confirmedAt: null,
      updatedAt: NOW,
      providerEvidence: [
        {
          observedAt: NOW,
          attempt: 2,
          providerStatus: "PENDING",
          normalizedStatus: "pending",
          legId: "source:8453:0",
          transactionId: "particle-83",
          confirmedHash: null,
          error: null,
          raw: { signature: "must-never-leave-server", huge: ["payload"] },
        },
      ],
    },
    {
      legId: "destination:42161:0",
      kind: "destination",
      chainId: 42161,
      chainName: "Arbitrum",
      required: true,
      status: "pending",
      confirmedHash: null,
      attemptCount: 2,
      lastProviderStatus: "PENDING",
      lastError: null,
      submittedAt: NOW,
      confirmedAt: null,
      updatedAt: NOW,
      providerEvidence: [],
    },
  ];
}

function execution(
  suffix: string,
  outcome: "pending" | "partial" | "needs_attention",
): ExecutionFinalityRecord {
  const initial = createExecutionFinalityRecord({
    executionId: `20000000-0000-4000-8000-0000000000${suffix}`,
    agentId: AGENT,
    permitId: `30000000-0000-4000-8000-0000000000${suffix}`,
    quoteId: `40000000-0000-4000-8000-0000000000${suffix}`,
    idempotencyKey: `operator-finality-${suffix}`,
    particleTransactionId: `particle-${suffix}`,
    outcome: "pending",
    legs: legs(),
    providerEvidence: [
      {
        observedAt: NOW,
        attempt: 2,
        providerStatus: "EXECUTION_PENDING",
        normalizedStatus: "pending",
        legId: null,
        transactionId: `particle-${suffix}`,
        confirmedHash: null,
        error: null,
        raw: { credential: "redact-me" },
      },
    ],
    workflowCorrelationId: `correlation-${suffix}`,
    workflowRunId: `workflow-${suffix}`,
    createdAt: NOW,
  });
  if (outcome === "pending") {
    return { ...initial, attemptCount: 2, lastProviderStatus: "EXECUTION_PENDING" };
  }
  const terminalLegs = initial.legs.map((leg, index) => ({
    ...leg,
    status:
      outcome === "partial" && index === 0
        ? ("finalized" as const)
        : outcome === "partial"
          ? ("failed" as const)
          : ("needs_attention" as const),
    confirmedHash:
      outcome === "partial" && index === 0
        ? `0x${"a".repeat(64)}`
        : null,
    confirmedAt: outcome === "partial" && index === 0 ? NOW : null,
    lastProviderStatus:
      outcome === "partial" && index === 0 ? "COMPLETED" : "FAILED",
  }));
  return {
    ...initial,
    outcome,
    legs: terminalLegs,
    attemptCount: 5,
    lastProviderStatus: "EXECUTION_FAILED",
    lastError: "Destination did not settle.",
    operatorRecovery:
      outcome === "needs_attention"
        ? {
            summary: "Destination finality is inconsistent.",
            affectedLegIds: ["destination:42161:0"],
            steps: ["Inspect confirmed and unresolved legs."],
          }
        : null,
  };
}

function retirement(): AgentRetirementRecord {
  return {
    retirementId: "50000000-0000-4000-8000-000000000083",
    agentId: AGENT,
    ownerUserId: OWNER,
    returnAddress: "0x2222222222222222222222222222222222222222",
    idempotencyKey: "retirement-83",
    reconciliationState: "needs_attention",
    conversionLegs: [
      {
        legId: "conversion:eth:Base",
        kind: "conversion",
        fromAsset: "eth",
        fromChain: "Base",
        sizeUsd: 20,
        status: "needs_attention",
        quote: null,
        rootHash: null,
        transactionId: "particle-retirement-83",
        receiptId: null,
        finality: {
          outcome: "partial",
          providerStatus: "EXECUTION_FAILED",
          attemptCount: 5,
          submittedAt: NOW,
          confirmedAt: null,
          confirmedHashes: [],
          providerEvidence: [],
        },
        error: "Conversion destination failed.",
      },
    ],
    transferLeg: null,
    residualHoldings: [],
    residualObservation: {
      consecutiveDustObservations: 0,
      firstDustObservedAt: null,
      lastObservedAt: NOW,
      lastResidualUsd: 20,
    },
    recoveredUsd: 0,
    dustUsd: 0,
    attemptCount: 5,
    workflowRunId: "retirement-workflow-83",
    lastError: "Conversion destination failed.",
    recoveryClaimToken: null,
    recoveryClaimedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  };
}

describe("operator finality evidence", () => {
  it("lists and views owned pending/partial/attention evidence and rejects another agent", async () => {
    const executionStore = new MemoryExecutionFinalityStore({
      schemaVersion: 1,
      records: [
        execution("81", "pending"),
        execution("82", "partial"),
        execution("83", "needs_attention"),
      ],
    });
    const retirementStore = new MemoryAgentRetirementStore();
    await retirementStore.save(retirement());

    const owned = await loadOperatorFinalityStatus({
      ownerUserId: OWNER,
      agentId: AGENT,
      executionStore,
      retirementStore,
      quoteStore: new MemoryAgentQuoteStore(),
    });
    expect(owned.executions.map((item) => item.mode).sort()).toEqual([
      "needs_attention",
      "needs_attention",
      "reconciling",
    ]);
    expect(owned.retirement?.mode).toBe("needs_attention");
    expect(JSON.stringify(owned)).not.toMatch(
      /must-never-leave-server|redact-me|credential|signature/,
    );

    const viewed = await loadOperatorFinalityStatus({
      ownerUserId: OWNER,
      agentId: AGENT,
      executionStore,
      retirementStore,
      quoteStore: new MemoryAgentQuoteStore(),
      executionId: "20000000-0000-4000-8000-000000000081",
    });
    expect(viewed.executions).toHaveLength(1);

    await expect(
      loadOperatorFinalityStatus({
        ownerUserId: "did:privy:other",
        agentId: OTHER_AGENT,
        executionStore,
        retirementStore,
        quoteStore: new MemoryAgentQuoteStore(),
        executionId: "20000000-0000-4000-8000-000000000081",
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });

    await expect(
      loadOperatorFinalityStatus({
        ownerUserId: "did:privy:other",
        agentId: AGENT,
        executionStore,
        retirementStore,
        quoteStore: new MemoryAgentQuoteStore(),
        retirementId: "50000000-0000-4000-8000-000000000083",
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
  });

  it("labels pending work as reconciling without a success or manual-action claim", async () => {
    const executionStore = new MemoryExecutionFinalityStore({
      schemaVersion: 1,
      records: [execution("81", "pending")],
    });
    const status = await loadOperatorFinalityStatus({
      ownerUserId: OWNER,
      agentId: AGENT,
      executionStore,
      retirementStore: new MemoryAgentRetirementStore(),
      quoteStore: new MemoryAgentQuoteStore(),
    });
    expect(status.executions[0]).toMatchObject({
      mode: "reconciling",
      retrySafe: true,
      recovery: { manualActionRequired: false },
    });
    expect(status.executions[0]?.recovery.summary).not.toMatch(
      /success|manual action required/i,
    );
  });

  it("advances pending execution using only the read-only status capability", async () => {
    const store = new MemoryExecutionFinalityStore({
      schemaVersion: 1,
      records: [execution("81", "pending")],
    });
    let statusReads = 0;
    const updated = await createExecutionReconciler({
      store,
      ua: {
        async getTransactionStatus(transactionId) {
          statusReads += 1;
          return {
            transactionId,
            providerStatus: "EXECUTION_PENDING",
            outcome: "pending",
            legs: [],
            retrySafe: true,
            error: null,
            raw: null,
          };
        },
      },
    }).reconcile("20000000-0000-4000-8000-000000000081");
    expect(statusReads).toBe(1);
    expect(updated.outcome).toBe("pending");
    expect(updated.attemptCount).toBe(3);
  });

  it("keeps retirement value-moving recovery on the original-signer path", () => {
    const status = retirementStatusForOperator(retirement());
    expect(status.recovery).toMatchObject({
      manualActionRequired: true,
    });
    expect(status.recovery.steps.join(" ")).toContain(
      "conviction-mcp retire --profile <name>",
    );
    expect(JSON.stringify(status)).not.toMatch(/rootHash|rawTransaction/);
  });
});
