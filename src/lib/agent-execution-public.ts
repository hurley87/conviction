import type {
  ExecutionFinalityRecord,
  ExecutionOutcome,
  ExecutionSettlementStatus,
} from "@/lib/agent-execution-finality";
import { explorerUrl } from "@/lib/verbs/chains";

export type AgentExecutionLifecycle = {
  executionId: string;
  quoteId: string;
  transactionId: string | null;
  outcome: ExecutionOutcome;
  settlementStatus: ExecutionSettlementStatus;
  attemptCount: number;
  lastProviderStatus: string | null;
  lastError: string | null;
  workflow: {
    runId: string | null;
    correlationId: string | null;
  };
  recovery: {
    summary: string;
    affectedLegIds: string[];
    steps: string[];
  } | null;
  legs: Array<{
    legId: string;
    kind: string;
    chainId: number;
    chainName: string;
    required: boolean;
    status: "submitted" | "pending" | "finalized" | "failed" | "needs_attention";
    confirmedHash: string | null;
    explorerUrl: string | null;
    attemptCount: number;
    lastProviderStatus: string | null;
    lastError: string | null;
    submittedAt: string | null;
    confirmedAt: string | null;
  }>;
  evidence: Array<{
    observedAt: string;
    attempt: number;
    providerStatus: string | null;
    normalizedStatus: ExecutionOutcome | null;
    legId: string | null;
    error: string | null;
  }>;
};

/**
 * Agent-safe execution evidence. Raw provider payloads, signatures, signer
 * material, and unconfirmed/planned hashes never cross this boundary.
 */
export function toAgentExecutionLifecycle(
  record: ExecutionFinalityRecord,
): AgentExecutionLifecycle {
  return {
    executionId: record.executionId,
    quoteId: record.quoteId,
    transactionId: record.particleTransactionId,
    outcome: record.outcome,
    settlementStatus: record.settlementStatus,
    attemptCount: record.attemptCount,
    lastProviderStatus: record.lastProviderStatus,
    lastError: record.lastError ?? record.settlementError,
    workflow: {
      runId: record.workflowRunId,
      correlationId: record.workflowCorrelationId,
    },
    recovery: record.operatorRecovery
      ? {
          summary: record.operatorRecovery.summary,
          affectedLegIds: [...record.operatorRecovery.affectedLegIds],
          steps: [...record.operatorRecovery.steps],
        }
      : null,
    legs: record.legs.map((leg) => {
      const confirmedHash =
        leg.status === "finalized" ? leg.confirmedHash : null;
      return {
        legId: leg.legId,
        kind: leg.kind,
        chainId: leg.chainId,
        chainName: leg.chainName,
        required: leg.required,
        status: leg.status,
        confirmedHash,
        explorerUrl: confirmedHash
          ? explorerUrl(leg.chainId, confirmedHash)
          : null,
        attemptCount: leg.attemptCount,
        lastProviderStatus: leg.lastProviderStatus,
        lastError: leg.lastError,
        submittedAt: leg.submittedAt,
        confirmedAt: leg.confirmedAt,
      };
    }),
    evidence: record.providerEvidence.map((entry) => ({
      observedAt: entry.observedAt,
      attempt: entry.attempt,
      providerStatus: entry.providerStatus,
      normalizedStatus: entry.normalizedStatus,
      legId: entry.legId,
      error: entry.error,
    })),
  };
}
