// Settlement of terminal execution finality into accounting and durable results
// (ADR 0020 / 0040 / 0048). Extracted from agent-permit to keep the permit
// module focused on issue/submit orchestration.

import {
  commitBackExecution,
  type AgentBackRecordStore,
  type BackAttributionApplier,
  type BackWorkflowStarter,
} from "@/lib/agent-back";
import type {
  ExecutionFinalityRecord,
  ExecutionFinalityStore,
} from "@/lib/agent-execution-finality";
import type {
  AgentExecuteErrorBody,
  AgentExecuteResult,
  AgentExecuteSuccess,
  AgentIdempotencyStore,
  AgentReceiptPersist,
} from "@/lib/agent-execute";
import { toAgentExecutionLifecycle } from "@/lib/agent-execution-public";
import { emitOperatorEvent } from "@/lib/agent-operator-events";
import type {
  AgentPermitStore,
  AgentSpendLedger,
  ExecutionPermitRecord,
} from "@/lib/agent-permit";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import type { AgentQuoteAction, AgentQuoteStore } from "@/lib/agent-quote";
import {
  buildAgentTradeReceiptRecord,
  type AgentTradeReceiptStore,
} from "@/lib/agent-trade-receipt";
import { productAssetPrimarySymbol } from "@/lib/verbs/assets";
import { explorerUrl } from "@/lib/verbs/chains";
import {
  buildReceiptSummary,
  inferSpentSymbol,
  resolveReceiptSourceChain,
} from "@/lib/verbs/receipt";
import type { Receipt } from "@/lib/verbs/types";

/** Persist (or heal) the publishable trade-receipt record for a successful execute. */
export async function ensurePublishableTradeReceipt(options: {
  agentId: string;
  permit: ExecutionPermitRecord;
  receipt: Receipt;
  entryAt: string;
  quoteStore: AgentQuoteStore;
  tradeReceipts: AgentTradeReceiptStore;
}): Promise<void> {
  const existing = await options.tradeReceipts.get(options.receipt.slug);
  if (existing) return;

  const quote = await options.quoteStore.get(options.permit.quoteId);
  await options.tradeReceipts.save(
    buildAgentTradeReceiptRecord({
      agentId: options.agentId,
      receipt: options.receipt,
      entryAt: options.entryAt,
      quoteId: options.permit.quoteId,
      quoteFingerprint: options.permit.quoteFingerprint,
      intent: options.permit.intent,
      sizeUsd: options.permit.sizeUsd,
      dollarsIn: options.receipt.dollarsIn,
      dollarsOut: options.receipt.dollarsOut,
      feeUsd: options.receipt.feeUsd,
      sourceChain: options.permit.agreedQuote.sourceChain,
      destChain: options.permit.agreedQuote.destChain,
      toAsset: options.permit.agreedQuote.toAsset,
      ...(options.permit.agreedQuote.receivedSymbol
        ? { receivedSymbol: options.permit.agreedQuote.receivedSymbol }
        : {}),
      publicationIntent: quote?.publicationIntent ?? false,
      ...(quote?.gateReport ? { gateReport: quote.gateReport } : {}),
      ...(quote?.gateVersion ? { gateVersion: quote.gateVersion } : {}),
      ...(quote?.targetFingerprint
        ? { targetFingerprint: quote.targetFingerprint }
        : {}),
    }),
  );
}

export function executionPendingResult(
  record: ExecutionFinalityRecord,
  action?: AgentQuoteAction,
): AgentExecuteErrorBody {
  const terminal = record.outcome === "finalized";
  const terminalMessage =
    record.outcome === "partial"
      ? "Execution is partial. Confirmed legs are retained, publication is disabled, and the spend reservation remains held."
      : record.outcome === "failed"
        ? "Execution failed with no confirmed successful value-moving leg. It remains a non-success result."
        : record.outcome === "needs_attention"
          ? "Execution finality needs operator attention. Do not resign or resubmit the transaction."
          : "Execution finality is unresolved. The same durable transaction is being reconciled; do not resign or resubmit.";
  return {
    ok: false,
    code: record.outcome,
    outcome: record.outcome,
    message: terminal
      ? record.settlementError ??
        "Execution is confirmed by Particle and is awaiting finalized receipt settlement."
      : terminalMessage,
    ...(action ? { action } : {}),
    quoteId: record.quoteId,
    execution: toAgentExecutionLifecycle(record),
  };
}

async function patchExecutionSettlement(input: {
  store: ExecutionFinalityStore;
  record: ExecutionFinalityRecord;
  at: string;
  patch: Parameters<ExecutionFinalityStore["transition"]>[0]["patch"];
}): Promise<ExecutionFinalityRecord | null> {
  return input.store.transition({
    executionId: input.record.executionId,
    expectedVersion: input.record.version,
    from: input.record.outcome,
    to: input.record.outcome,
    updatedAt: input.at,
    patch: input.patch,
  });
}

function confirmedReceipt(
  record: ExecutionFinalityRecord,
  permit: ExecutionPermitRecord,
): Receipt | null {
  const required = record.legs.filter((leg) => leg.required);
  if (
    record.outcome !== "finalized" ||
    required.length === 0 ||
    required.some(
      (leg) => leg.status !== "finalized" || !leg.confirmedHash,
    )
  ) {
    return null;
  }
  const legs = record.legs
    .filter((leg) => leg.status === "finalized" && leg.confirmedHash)
    .map((leg) => ({
      chain: leg.chainName,
      txHash: leg.confirmedHash!,
      explorerUrl: explorerUrl(leg.chainId, leg.confirmedHash!),
    }));
  const sourceChain = resolveReceiptSourceChain(
    permit.agreedQuote.sourceChain,
    permit.agreedQuote.destChain,
    legs,
  );
  const summary = buildReceiptSummary(
    permit.dollarsIn,
    permit.agreedQuote.dollarsOut,
    sourceChain,
    permit.agreedQuote.destChain,
    permit.agreedQuote.receivedSymbol ??
      productAssetPrimarySymbol(permit.agreedQuote.toAsset),
    inferSpentSymbol(permit.intent),
  );
  return {
    slug: record.executionId,
    legs,
    summary,
    dollarsIn: permit.dollarsIn,
    dollarsOut: permit.agreedQuote.dollarsOut,
    feeUsd: permit.agreedQuote.feeUsd,
  };
}

export type SettlementOptions = {
  agent: OwnedAgent;
  record: ExecutionFinalityRecord;
  permitStore: AgentPermitStore;
  idempotencyStore: AgentIdempotencyStore;
  receipts: AgentReceiptPersist;
  quoteStore: AgentQuoteStore;
  tradeReceipts?: AgentTradeReceiptStore;
  backStore?: AgentBackRecordStore;
  startBackWorkflow?: BackWorkflowStarter;
  attributeBack?: BackAttributionApplier;
  executionFinalityStore: ExecutionFinalityStore;
  spendLedger?: AgentSpendLedger;
  onSpend?: (dollarsIn: number) => void | Promise<void>;
  now?: () => Date;
  randomId?: () => string;
};

function emitExecutionFinalityAttention(
  agent: OwnedAgent,
  record: ExecutionFinalityRecord,
  outcome:
    | "partial"
    | "failed"
    | "needs_attention" = record.outcome === "partial" ||
    record.outcome === "failed"
    ? record.outcome
    : "needs_attention",
): void {
  const affected =
    record.legs.find(
      (leg) =>
        leg.status === "failed" ||
        leg.status === "needs_attention" ||
        leg.status === "pending" ||
        leg.status === "submitted",
    ) ?? null;
  emitOperatorEvent({
    type: "execution_finality_attention",
    agentId: agent.agentId,
    ownerUserId: agent.ownerUserId,
    executionId: record.executionId,
    transactionId: record.particleTransactionId,
    outcome,
    affectedLeg: affected
      ? {
          legId: affected.legId,
          kind: affected.kind,
          chainName: affected.chainName,
          status: affected.status,
          lastProviderStatus: affected.lastProviderStatus,
          confirmedHash: affected.confirmedHash,
          error: affected.lastError,
        }
      : null,
    lastProviderStatus: record.lastProviderStatus,
    workflowRunId: record.workflowRunId,
    correlationId: record.workflowCorrelationId,
    recoveryPath:
      record.operatorRecovery?.steps.join(" ") ??
      "Inspect confirmed and unresolved legs in Agent Access. Do not sign or resubmit the stored transaction; use read-only retry only for reconciliation or settlement bookkeeping.",
  });
}

/** Convert terminal provider finality into accounting and a durable result once. */
export async function settleExecutionFinality(
  options: SettlementOptions,
): Promise<AgentExecuteResult> {
  let record = options.record;
  if (record.settlementResult) return record.settlementResult;

  const permit = await options.permitStore.get(record.permitId);
  if (!permit || permit.agentId !== options.agent.agentId) {
    return executionPendingResult(record);
  }

  if (record.outcome === "failed") {
    const released = await options.permitStore.casStatus(
      permit.permitId,
      "pending",
      "released",
    );
    if (released) {
      await options.spendLedger?.release(options.agent.agentId, permit.dollarsIn);
    }
    if (record.settlementStatus !== "released") {
      record =
        (await patchExecutionSettlement({
          store: options.executionFinalityStore,
          record,
          at: (options.now?.() ?? new Date()).toISOString(),
          patch: { settlementStatus: "released", settlementError: null },
        })) ?? record;
    }
    emitExecutionFinalityAttention(options.agent, record, "failed");
    return executionPendingResult(record, permit.action);
  }

  if (record.outcome !== "finalized") {
    if (
      record.outcome === "partial" ||
      record.outcome === "needs_attention"
    ) {
      emitExecutionFinalityAttention(options.agent, record);
    }
    return executionPendingResult(record, permit.action);
  }
  const receipt = confirmedReceipt(record, permit);
  if (!receipt) {
    const message =
      "Finalized execution lacks confirmed evidence for every required leg.";
    const updated =
      (await patchExecutionSettlement({
        store: options.executionFinalityStore,
        record,
        at: (options.now?.() ?? new Date()).toISOString(),
        patch: {
          settlementStatus: "needs_attention",
          settlementError: message,
        },
      })) ?? { ...record, settlementStatus: "needs_attention" as const };
    emitExecutionFinalityAttention(options.agent, updated, "needs_attention");
    return executionPendingResult(
      { ...updated, settlementError: message },
      permit.action,
    );
  }

  if (record.settlementStatus === "held") {
    const claimed = await patchExecutionSettlement({
      store: options.executionFinalityStore,
      record,
      at: (options.now?.() ?? new Date()).toISOString(),
      patch: { settlementStatus: "accounting", settlementError: null },
    });
    if (!claimed) {
      const latest = await options.executionFinalityStore.get(record.executionId);
      return latest?.settlementResult ?? executionPendingResult(latest ?? record, permit.action);
    }
    record = claimed;

    const accountingClaimed = await options.permitStore.casStatus(
      permit.permitId,
      "pending",
      "consumed",
    );
    if (!accountingClaimed) {
      const prior = await options.idempotencyStore.get(
        options.agent.agentId,
        record.idempotencyKey,
      );
      if (prior?.ok) return prior;
      return executionPendingResult(record, permit.action);
    }
    try {
      await options.onSpend?.(permit.dollarsIn);
      await options.spendLedger?.commit(options.agent.agentId, permit.dollarsIn);
      record =
        (await patchExecutionSettlement({
          store: options.executionFinalityStore,
          record,
          at: (options.now?.() ?? new Date()).toISOString(),
          patch: { settlementStatus: "persisting", settlementError: null },
        })) ?? record;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Confirmed spend settlement failed.";
      const updated =
        (await patchExecutionSettlement({
          store: options.executionFinalityStore,
          record,
          at: (options.now?.() ?? new Date()).toISOString(),
          patch: {
            settlementStatus: "needs_attention",
            settlementError: message,
          },
        })) ?? record;
      emitExecutionFinalityAttention(
        options.agent,
        updated,
        "needs_attention",
      );
      return executionPendingResult(
        { ...updated, settlementError: message },
        permit.action,
      );
    }
  }

  if (record.settlementStatus !== "persisting") {
    const latest = await options.executionFinalityStore.get(record.executionId);
    return latest?.settlementResult ?? executionPendingResult(latest ?? record, permit.action);
  }

  let success: AgentExecuteSuccess & { action: "trade" | "back" } = {
    ok: true,
    outcome: "finalized",
    receiptId: receipt.slug,
    quoteId: permit.quoteId,
    quoteFingerprint: permit.quoteFingerprint,
    transactionId: record.particleTransactionId!,
    summary: receipt.summary,
    receipt,
    dollarsIn: permit.dollarsIn,
    dollarsOut: receipt.dollarsOut,
    feeUsd: receipt.feeUsd,
    idempotencyKey: record.idempotencyKey,
    action: permit.action,
    ...(permit.entryId ? { entryId: permit.entryId } : {}),
  };
  try {
    await options.receipts.save(receipt);
    if (permit.action === "trade" && options.tradeReceipts) {
      await ensurePublishableTradeReceipt({
        agentId: options.agent.agentId,
        permit,
        receipt,
        entryAt: record.finalizedAt ?? (options.now?.() ?? new Date()).toISOString(),
        quoteStore: options.quoteStore,
        tradeReceipts: options.tradeReceipts,
      });
    }
    if (
      permit.action === "back" &&
      permit.entryId &&
      options.backStore &&
      options.startBackWorkflow
    ) {
      success = await commitBackExecution({
        agent: options.agent,
        execute: success,
        entryId: permit.entryId,
        backStore: options.backStore,
        idempotencyStore: options.idempotencyStore,
        startWorkflow: options.startBackWorkflow,
        confirmedFinality: true,
        ...(options.attributeBack ? { attributeNow: options.attributeBack } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.randomId ? { randomId: options.randomId } : {}),
      });
    } else {
      await options.idempotencyStore.save(
        options.agent.agentId,
        record.idempotencyKey,
        success,
      );
    }
    const settled = await patchExecutionSettlement({
      store: options.executionFinalityStore,
      record,
      at: (options.now?.() ?? new Date()).toISOString(),
      patch: {
        settlementStatus: "settled",
        settlementResult: { ...success, outcome: "finalized" },
        settlementError: null,
      },
    });
    if (!settled) {
      const latest = await options.executionFinalityStore.get(record.executionId);
      if (latest?.settlementResult) return latest.settlementResult;
    }
    if (permit.action === "trade") {
      emitOperatorEvent({
        type: "trade_executed",
        agentId: options.agent.agentId,
        ownerUserId: options.agent.ownerUserId,
        receiptId: success.receiptId,
        transactionId: success.transactionId,
        summary: success.summary,
      });
    }
    return success;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finalized receipt persistence failed.";
    const updated =
      (await patchExecutionSettlement({
        store: options.executionFinalityStore,
        record,
        at: (options.now?.() ?? new Date()).toISOString(),
        patch: {
          settlementStatus: "needs_attention",
          settlementError: message,
        },
      })) ?? record;
    emitExecutionFinalityAttention(
      options.agent,
      updated,
      "needs_attention",
    );
    return executionPendingResult(
      { ...updated, settlementError: message },
      permit.action,
    );
  }
}
