import "server-only";

import {
  executionRetryEligibility,
  type ExecutionFinalityRecord,
  type ExecutionFinalityStore,
  type ExecutionProviderEvidence,
} from "@/lib/agent-execution-finality";
import type { AgentQuoteStore } from "@/lib/agent-quote";
import type {
  AgentRetirementRecord,
  AgentRetirementStore,
  RetirementConversionLeg,
  RetirementTransferLeg,
} from "@/lib/agent-retirement";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { chainName, explorerUrlIfKnown } from "@/lib/verbs/chains";

export type OperatorFinalityMode =
  | "reconciling"
  | "needs_attention"
  | "resolved";

export type OperatorProviderEvidence = Omit<
  ExecutionProviderEvidence,
  "raw" | "error"
> & {
  error: string | null;
};

export type OperatorFinalityLeg = {
  legId: string;
  action: string;
  chainId: number | null;
  chainName: string;
  required: boolean;
  status: string;
  transactionId: string | null;
  quote:
    | {
        type: "trade";
        fromAsset: string;
        toAsset: string;
        sizeUsd: number;
        dollarsIn: number;
        dollarsOut: number;
        feeUsd: number;
        sourceChain: string;
        destChain: string;
      }
    | {
        type: "withdrawal";
        asset: string;
        amount: string;
        destination: string;
        estimatedDebitUsd: number;
        feeUsd: number;
        maxDebitUsd: number;
        destChain: string;
      }
    | null;
  confirmedHashes: Array<{
    hash: string;
    explorerUrl: string | null;
    chainId: number;
    chainName: string;
  }>;
  lastNormalizedStatus: string | null;
  lastProviderStatus: string | null;
  attemptCount: number;
  lastError: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  evidence: OperatorProviderEvidence[];
};

export type OperatorExecutionStatus = {
  resourceType: "execution";
  mode: OperatorFinalityMode;
  executionId: string;
  agentId: string;
  particleTransactionId: string | null;
  permitId: string;
  quoteId: string;
  action: "trade" | "back" | null;
  outcome: ExecutionFinalityRecord["outcome"];
  settlementStatus: ExecutionFinalityRecord["settlementStatus"];
  retrySafe: boolean;
  legs: OperatorFinalityLeg[];
  lastNormalizedStatus: string | null;
  lastProviderStatus: string | null;
  attemptCount: number;
  workflowCorrelationId: string | null;
  workflowRunId: string | null;
  lastError: string | null;
  recovery: {
    manualActionRequired: boolean;
    summary: string;
    steps: string[];
  };
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
};

export type OperatorRetirementStatus = {
  resourceType: "retirement";
  mode: OperatorFinalityMode;
  retirementId: string;
  agentId: string;
  reconciliationState: AgentRetirementRecord["reconciliationState"];
  retrySafe: boolean;
  legs: OperatorFinalityLeg[];
  residualHoldings: AgentRetirementRecord["residualHoldings"];
  recoveredUsd: number;
  dustUsd: number;
  attemptCount: number;
  workflowRunId: string | null;
  lastError: string | null;
  recovery: {
    manualActionRequired: boolean;
    summary: string;
    steps: string[];
  };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type OperatorFinalityStatus = {
  executions: OperatorExecutionStatus[];
  retirement: OperatorRetirementStatus | null;
};

function safeText(value: string | null | undefined, max = 500): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}

function safeEvidence(
  evidence: ExecutionProviderEvidence[],
): OperatorProviderEvidence[] {
  return evidence.slice(-5).map((item) => ({
    observedAt: item.observedAt,
    attempt: item.attempt,
    providerStatus: safeText(item.providerStatus, 200),
    normalizedStatus: item.normalizedStatus,
    legId: safeText(item.legId, 200),
    transactionId: safeText(item.transactionId, 200),
    confirmedHash: safeText(item.confirmedHash, 200),
    error: safeText(item.error),
  }));
}

function confirmedExplorer(
  chainId: number,
  status: string,
  hash: string | null,
): OperatorFinalityLeg["confirmedHashes"] {
  if (status !== "finalized" && status !== "complete") return [];
  const confirmedHash = safeText(hash, 200);
  if (!confirmedHash) return [];
  return [
    {
      hash: confirmedHash,
      explorerUrl: explorerUrlIfKnown(chainId, confirmedHash),
      chainId,
      chainName: chainName(chainId),
    },
  ];
}

function lastNormalizedStatus(
  evidence: OperatorProviderEvidence[],
): string | null {
  return evidence.at(-1)?.normalizedStatus ?? null;
}

function executionMode(
  record: ExecutionFinalityRecord,
): OperatorFinalityMode {
  if (
    record.outcome === "submitted" ||
    record.outcome === "pending" ||
    (record.outcome === "finalized" &&
      record.settlementStatus !== "settled" &&
      record.settlementStatus !== "needs_attention")
  ) {
    return "reconciling";
  }
  if (
    record.outcome === "partial" ||
    record.outcome === "failed" ||
    record.outcome === "needs_attention" ||
    record.settlementStatus === "needs_attention"
  ) {
    return "needs_attention";
  }
  return "resolved";
}

function executionRecovery(
  record: ExecutionFinalityRecord,
  mode: OperatorFinalityMode,
): OperatorExecutionStatus["recovery"] {
  if (mode === "reconciling") {
    return {
      manualActionRequired: false,
      summary:
        record.outcome === "finalized"
          ? "Provider finality is confirmed; idempotent settlement bookkeeping is still reconciling."
          : "Read-only provider reconciliation is still in progress. Do not sign or submit another transaction.",
      steps: [
        "Wait for the existing transaction to reach terminal provider finality.",
        "Use read-only retry only if reconciliation has stopped advancing.",
      ],
    };
  }
  if (mode === "resolved") {
    return {
      manualActionRequired: false,
      summary: "Execution and settlement are finalized.",
      steps: [],
    };
  }
  return {
    manualActionRequired: true,
    summary:
      safeText(
        record.operatorRecovery?.summary ??
          record.settlementError ??
          record.lastError,
      ) ?? "This execution needs manual operator review.",
    steps:
      record.operatorRecovery?.steps
        .slice(0, 6)
        .map((step) => safeText(step, 300))
        .filter((step): step is string => Boolean(step)) ?? [
        "Inspect the confirmed and unresolved legs below.",
        "Do not sign or resubmit the stored transaction.",
      ],
  };
}

export async function executionStatusForOperator(
  record: ExecutionFinalityRecord,
  quoteStore: Pick<AgentQuoteStore, "get">,
): Promise<OperatorExecutionStatus> {
  const quote = await quoteStore.get(record.quoteId);
  const mode = executionMode(record);
  const evidence = safeEvidence(record.providerEvidence);
  return {
    resourceType: "execution",
    mode,
    executionId: record.executionId,
    agentId: record.agentId,
    particleTransactionId: safeText(record.particleTransactionId, 200),
    permitId: record.permitId,
    quoteId: record.quoteId,
    action:
      quote?.agentId === record.agentId
        ? quote.action
        : record.settlementResult?.action ?? null,
    outcome: record.outcome,
    settlementStatus: record.settlementStatus,
    retrySafe: executionRetryEligibility(record).retrySafe,
    legs: record.legs.map((leg) => {
      const legEvidence = safeEvidence(leg.providerEvidence);
      return {
        legId: leg.legId,
        action: leg.kind,
        chainId: leg.chainId,
        chainName: leg.chainName,
        required: leg.required,
        status: leg.status,
        transactionId: safeText(record.particleTransactionId, 200),
        quote: null,
        confirmedHashes: confirmedExplorer(
          leg.chainId,
          leg.status,
          leg.confirmedHash,
        ),
        lastNormalizedStatus: lastNormalizedStatus(legEvidence),
        lastProviderStatus: safeText(leg.lastProviderStatus, 200),
        attemptCount: leg.attemptCount,
        lastError: safeText(leg.lastError),
        submittedAt: leg.submittedAt,
        confirmedAt: leg.confirmedAt,
        updatedAt: leg.updatedAt,
        evidence: legEvidence,
      };
    }),
    lastNormalizedStatus: lastNormalizedStatus(evidence),
    lastProviderStatus: safeText(record.lastProviderStatus, 200),
    attemptCount: record.attemptCount,
    workflowCorrelationId: safeText(record.workflowCorrelationId, 200),
    workflowRunId: safeText(record.workflowRunId, 200),
    lastError: safeText(record.lastError ?? record.settlementError),
    recovery: executionRecovery(record, mode),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    finalizedAt: record.finalizedAt,
  };
}

function retirementMode(
  retirement: AgentRetirementRecord,
): OperatorFinalityMode {
  if (retirement.reconciliationState === "complete") return "resolved";
  if (retirement.reconciliationState === "pending_sync") return "reconciling";
  return "needs_attention";
}

function retirementLeg(
  leg: RetirementConversionLeg | RetirementTransferLeg,
  updatedAt: string,
): OperatorFinalityLeg {
  const evidence = safeEvidence(leg.finality.providerEvidence);
  const confirmedHashes =
    leg.status === "complete"
      ? leg.finality.confirmedHashes.map((confirmed) => ({
          hash: confirmed.confirmedHash,
          explorerUrl: explorerUrlIfKnown(
            confirmed.chainId,
            confirmed.confirmedHash,
          ),
          chainId: confirmed.chainId,
          chainName: confirmed.chainName,
        }))
      : [];
  const quote =
    leg.kind === "conversion" && leg.quote
      ? {
          type: "trade" as const,
          fromAsset: leg.fromAsset,
          toAsset: leg.quote.toAsset,
          sizeUsd: leg.sizeUsd,
          dollarsIn: leg.quote.dollarsIn,
          dollarsOut: leg.quote.dollarsOut,
          feeUsd: leg.quote.feeUsd,
          sourceChain: leg.quote.sourceChain,
          destChain: leg.quote.destChain,
        }
      : leg.kind === "transfer" && leg.quote
        ? {
            type: "withdrawal" as const,
            asset: leg.quote.asset,
            amount: leg.quote.amount,
            destination: leg.quote.destination,
            estimatedDebitUsd: leg.quote.estimatedDebitUsd,
            feeUsd: leg.quote.feeUsd,
            maxDebitUsd: leg.quote.maxDebitUsd,
            destChain: leg.quote.destChain,
          }
        : null;
  return {
    legId: leg.legId,
    action: leg.kind,
    chainId: null,
    chainName:
      leg.kind === "conversion" ? leg.fromChain : leg.destChain,
    required: true,
    status: leg.status,
    transactionId: safeText(leg.transactionId, 200),
    quote,
    confirmedHashes,
    lastNormalizedStatus:
      leg.finality.outcome ?? lastNormalizedStatus(evidence),
    lastProviderStatus: safeText(leg.finality.providerStatus, 200),
    attemptCount: leg.finality.attemptCount,
    lastError: safeText(leg.error),
    submittedAt: leg.finality.submittedAt,
    confirmedAt: leg.finality.confirmedAt,
    updatedAt,
    evidence,
  };
}

export function retirementStatusForOperator(
  retirement: AgentRetirementRecord,
): OperatorRetirementStatus {
  const mode = retirementMode(retirement);
  const manualActionRequired = mode === "needs_attention";
  return {
    resourceType: "retirement",
    mode,
    retirementId: retirement.retirementId,
    agentId: retirement.agentId,
    reconciliationState: retirement.reconciliationState,
    retrySafe: retirement.reconciliationState !== "complete",
    legs: [
      ...retirement.conversionLegs.map((leg) =>
        retirementLeg(leg, retirement.updatedAt),
      ),
      ...(retirement.transferLeg
        ? [retirementLeg(retirement.transferLeg, retirement.updatedAt)]
        : []),
    ],
    residualHoldings: retirement.residualHoldings.map((holding) => ({
      ...holding,
      reason: safeText(holding.reason, 300) ?? "Residual holding.",
    })),
    recoveredUsd: retirement.recoveredUsd,
    dustUsd: retirement.dustUsd,
    attemptCount: retirement.attemptCount,
    workflowRunId: safeText(retirement.workflowRunId, 200),
    lastError: safeText(retirement.lastError),
    recovery: {
      manualActionRequired,
      summary:
        mode === "resolved"
          ? "Retirement recovery is complete."
          : mode === "reconciling"
            ? "Read-only retirement finality and residual checks are still reconciling."
            : "Manual value-moving recovery requires the original local signer.",
      steps:
        mode === "resolved"
          ? []
          : mode === "reconciling"
            ? [
                "Wait for submitted legs and residual checks to reach confirmed finality.",
                "Use read-only retry only if reconciliation has stopped advancing.",
              ]
            : [
                "Inspect the affected retirement leg and confirmed evidence.",
                "Run conviction-mcp retire --profile <name> with the original local signer for any new value-moving recovery.",
                "Return here to retry read-only reconciliation after manual recovery.",
              ],
    },
    createdAt: retirement.createdAt,
    updatedAt: retirement.updatedAt,
    completedAt: retirement.completedAt,
  };
}

export async function loadOperatorFinalityStatus(input: {
  ownerUserId: string;
  agentId: string;
  executionStore: ExecutionFinalityStore;
  retirementStore: AgentRetirementStore;
  quoteStore: Pick<AgentQuoteStore, "get">;
  executionId?: string;
  retirementId?: string;
  limit?: number;
}): Promise<OperatorFinalityStatus> {
  let records: ExecutionFinalityRecord[];
  if (input.executionId) {
    const record = await input.executionStore.get(input.executionId);
    if (!record || record.agentId !== input.agentId) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No execution matches that identity for this account.",
      );
    }
    records = [record];
  } else {
    records = await input.executionStore.listByAgentId(
      input.agentId,
      input.limit ?? 25,
    );
  }

  let retirement: AgentRetirementRecord | null;
  if (input.retirementId) {
    retirement = await input.retirementStore.get(input.retirementId);
    if (
      !retirement ||
      retirement.agentId !== input.agentId ||
      retirement.ownerUserId !== input.ownerUserId
    ) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement matches that identity for this account.",
      );
    }
  } else {
    retirement = await input.retirementStore.getByAgentId(input.agentId);
    if (retirement?.ownerUserId !== input.ownerUserId) retirement = null;
  }

  return {
    executions: await Promise.all(
      records.map((record) =>
        executionStatusForOperator(record, input.quoteStore),
      ),
    ),
    retirement: retirement ? retirementStatusForOperator(retirement) : null,
  };
}
