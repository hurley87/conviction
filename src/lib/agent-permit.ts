// Execution permits for MCP value-moving actions (ADR 0020 / 0040 / 0048).
// Quote alone never authorizes signing — MCP must obtain a live permit first.

import { randomUUID } from "node:crypto";
import { getAddress, getBytes, verifyMessage } from "ethers";

import {
  attachExecutionWorkflowRun,
  createPreSubmissionExecution,
  markExecutionSubmissionUncertain,
  markExecutionSubmitted,
  type ExecutionReconciler,
  type ExecutionWorkflowStarter,
} from "@/lib/agent-execution-reconciliation";
import type {
  ExecutionFinalityRecord,
  ExecutionFinalityStore,
} from "@/lib/agent-execution-finality";
import { emitOperatorEvent } from "@/lib/agent-operator-events";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  AgentExecuteError,
  MemorySpendLedger,
  type AgentExecuteErrorBody,
  type AgentExecuteResult,
  type AgentExecuteSuccess,
  type AgentIdempotencyStore,
  type AgentReceiptPersist,
} from "@/lib/agent-execute";
import {
  commitBackExecution,
  loadBackQuoteForExecute,
  type AgentBackRecordStore,
  type BackAttributionApplier,
  type BackWorkflowStarter,
} from "@/lib/agent-back";
import {
  AgentQuoteError,
  loadTradeQuoteForExecute,
  type AgentQuoteAction,
  type AgentQuoteStore,
  type AgentTradeQuoteRecord,
} from "@/lib/agent-quote";
import {
  buildAgentTradeReceiptRecord,
  type AgentTradeReceiptStore,
} from "@/lib/agent-trade-receipt";
import type { UniversalBalance } from "@/lib/verbs/types";
import type { Receipt, TradeIntent, TradeQuote } from "@/lib/verbs/types";
import { assertTradeDebitWithinCeiling } from "@/lib/verbs/quote";
import type { RawTransaction } from "@/lib/ua/trade";
import { explorerUrl } from "@/lib/verbs/chains";
import {
  buildReceiptSummary,
  inferSpentSymbol,
  resolveReceiptSourceChain,
} from "@/lib/verbs/receipt";
import { productAssetPrimarySymbol } from "@/lib/verbs/assets";

/** Persist (or heal) the publishable trade-receipt record for a successful execute. */
async function ensurePublishableTradeReceipt(options: {
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

/** Permit lifetime capped well under the quote TTL (ADR 0020). */
export const EXECUTION_PERMIT_TTL_MS = 30_000;

export type ExecutionPermitStatus =
  | "issued"
  | "consumed"
  | "released"
  | "pending";

export type ExecutionPermitRecord = {
  permitId: string;
  agentId: string;
  leaseId: string;
  quoteId: string;
  quoteFingerprint: string;
  idempotencyKey: string;
  action: AgentQuoteAction;
  dollarsIn: number;
  floorUsd: number;
  intent: TradeIntent;
  sizeUsd: number;
  agreedQuote: TradeQuote;
  rawTransaction: unknown;
  issuedAt: string;
  expiresAt: string;
  status: ExecutionPermitStatus;
  /** Bound conviction for back permits. */
  entryId?: string;
};

export type IssuePermitSuccess = {
  ok: true;
  permitId: string;
  quoteId: string;
  quoteFingerprint: string;
  dollarsIn: number;
  floorUsd: number;
  expiresAt: string;
  intent: TradeIntent;
  sizeUsd: number;
  agreedQuote: TradeQuote;
  /** Opaque UA payload for local signing — never a new quote. */
  rawTransaction: unknown;
  transactionId: string;
  idempotencyKey: string;
};

export type IssuePermitResult = IssuePermitSuccess | AgentExecuteErrorBody;

export type SubmitSignedTradeInput = {
  permitId: string;
  idempotencyKey: string;
  leaseId: string;
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
};

/** Outcomes that are safe to durable-store under an idempotency key. */
function isDurablePermitError(code: AgentExecuteErrorBody["code"]): boolean {
  switch (code) {
    case "invalid_input":
    case "lifecycle_blocked":
    case "action_disabled":
    case "quote_not_found":
    case "quote_expired":
    case "quote_mismatch":
    case "insufficient_balance":
    case "price_floor_breached":
    case "spend_limit_exceeded":
      return true;
    case "unavailable":
      return false;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

async function maybePersist(
  store: AgentIdempotencyStore,
  agentId: string,
  idempotencyKey: string,
  result: AgentExecuteResult,
): Promise<AgentExecuteResult> {
  if (result.ok || isDurablePermitError(result.code)) {
    await store.save(agentId, idempotencyKey, result);
  }
  return result;
}

function permitResponse(record: ExecutionPermitRecord): IssuePermitSuccess {
  return {
    ok: true,
    permitId: record.permitId,
    quoteId: record.quoteId,
    quoteFingerprint: record.quoteFingerprint,
    dollarsIn: record.dollarsIn,
    floorUsd: record.floorUsd,
    expiresAt: record.expiresAt,
    intent: record.intent,
    sizeUsd: record.sizeUsd,
    agreedQuote: record.agreedQuote,
    rawTransaction: record.rawTransaction,
    transactionId: record.agreedQuote.transactionId,
    idempotencyKey: record.idempotencyKey,
  };
}

function executionPendingResult(
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
    code: "unavailable",
    message: terminal
      ? record.settlementError ??
        "Execution is confirmed by Particle and is awaiting finalized receipt settlement."
      : terminalMessage,
    ...(action ? { action } : {}),
    quoteId: record.quoteId,
    execution: record,
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

type SettlementOptions = {
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
        settlementResult: success,
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

async function advanceExistingExecution(options: {
  record: ExecutionFinalityRecord;
  store: ExecutionFinalityStore;
  workflow: ExecutionWorkflowStarter;
  ownerAddress: string;
  reconcile?: ExecutionReconciler;
  now?: () => Date;
}): Promise<ExecutionFinalityRecord> {
  let current = options.record;
  if (
    !current.workflowRunId &&
    current.outcome !== "finalized" &&
    current.outcome !== "partial" &&
    current.outcome !== "failed" &&
    current.outcome !== "needs_attention"
  ) {
    try {
      const started = await options.workflow.start(
        current.executionId,
        options.ownerAddress,
      );
      current = await attachExecutionWorkflowRun({
        store: options.store,
        executionId: current.executionId,
        runId: started.runId,
        at: (options.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      current = await markExecutionSubmissionUncertain({
        store: options.store,
        executionId: current.executionId,
        error:
          error instanceof Error
            ? new Error(`Could not start finality workflow: ${error.message}`)
            : new Error("Could not start finality workflow."),
        at: (options.now?.() ?? new Date()).toISOString(),
      });
    }
  }
  if (
    options.reconcile &&
    current.outcome !== "finalized" &&
    current.outcome !== "partial" &&
    current.outcome !== "failed" &&
    current.outcome !== "needs_attention"
  ) {
    current = await options.reconcile.reconcile(current.executionId);
  }
  return current;
}

export type SignedTradeSender = (input: {
  rawTransaction: RawTransaction;
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
  agreedQuote: TradeQuote;
  intent: TradeIntent;
  sizeUsd: number;
  receiptSlug: string;
}) => Promise<{
  transactionId: string;
  /** Legacy-only fields; confirmed receipts are created in commit 4. */
  receipt?: Receipt;
  summary?: string;
  uncertain?: boolean;
}>;

export type AgentPermitStore = {
  save(record: ExecutionPermitRecord): Promise<void>;
  get(permitId: string): Promise<ExecutionPermitRecord | null>;
  getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionPermitRecord | null>;
  /** Outstanding issued permits for an agent (used to invalidate on policy pause). */
  listIssuedByAgent(agentId: string): Promise<ExecutionPermitRecord[]>;
  /**
   * Atomically transition issued → consumed|pending|released.
   * Returns true only when this caller performed the transition.
   */
  casStatus(
    permitId: string,
    from: ExecutionPermitStatus,
    to: ExecutionPermitStatus,
  ): Promise<boolean>;
};

/** Async spend reservation surface shared by memory and Neon ledgers. */
export type AgentSpendLedger = {
  remainingUsd(
    agentId: string,
    spendBudgetUsd: number,
    lifetimeSpendUsd: number,
  ): number | Promise<number>;
  tryReserve(input: {
    agentId: string;
    dollarsIn: number;
    maxTradeUsd: number;
    spendBudgetUsd: number;
    lifetimeSpendUsd: number;
  }): boolean | Promise<boolean>;
  release(agentId: string, dollarsIn: number): void | Promise<void>;
  commit(agentId: string, dollarsIn: number): void | Promise<void>;
};

/** In-memory permit ledger for tests and offline mock paths. */
export class MemoryAgentPermitStore implements AgentPermitStore {
  private readonly records = new Map<string, ExecutionPermitRecord>();
  private readonly byIdempotency = new Map<string, string>();

  private idemKey(agentId: string, idempotencyKey: string): string {
    return `${agentId}\0${idempotencyKey}`;
  }

  async save(record: ExecutionPermitRecord): Promise<void> {
    this.records.set(record.permitId, structuredClone(record));
    this.byIdempotency.set(
      this.idemKey(record.agentId, record.idempotencyKey),
      record.permitId,
    );
  }

  async get(permitId: string): Promise<ExecutionPermitRecord | null> {
    const stored = this.records.get(permitId);
    return stored ? structuredClone(stored) : null;
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionPermitRecord | null> {
    const permitId = this.byIdempotency.get(
      this.idemKey(agentId, idempotencyKey),
    );
    if (!permitId) return null;
    return this.get(permitId);
  }

  async listIssuedByAgent(agentId: string): Promise<ExecutionPermitRecord[]> {
    const out: ExecutionPermitRecord[] = [];
    for (const record of this.records.values()) {
      if (record.agentId === agentId && record.status === "issued") {
        out.push(structuredClone(record));
      }
    }
    return out;
  }

  async casStatus(
    permitId: string,
    from: ExecutionPermitStatus,
    to: ExecutionPermitStatus,
  ): Promise<boolean> {
    const stored = this.records.get(permitId);
    if (!stored || stored.status !== from) return false;
    stored.status = to;
    return true;
  }

  clear(): void {
    this.records.clear();
    this.byIdempotency.clear();
  }
}

export type LifetimeSpendRecorder = {
  addLifetimeSpend(agentId: string, dollarsIn: number): Promise<OwnedAgent>;
};

function invalidInput(
  field: string,
  code: string,
  message: string,
): AgentExecuteError {
  return new AgentExecuteError("invalid_input", message, {
    fields: [{ field, code, message }],
  });
}

function assertExecuteLifecycle(agent: OwnedAgent): void {
  if (agent.status === "active") return;
  throw new AgentExecuteError(
    "lifecycle_blocked",
    `Agent @${agent.handle} is ${agent.status} and cannot execute trades.`,
  );
}

function assertTradeEnabled(agent: OwnedAgent): void {
  if (agent.actionPolicy.trade) return;
  throw new AgentExecuteError(
    "action_disabled",
    "Trade is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
    { action: "trade" },
  );
}

function assertBackEnabled(agent: OwnedAgent): void {
  if (agent.actionPolicy.back) return;
  throw new AgentExecuteError(
    "action_disabled",
    "Back is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
    { action: "back" },
  );
}

function assertActionEnabled(
  agent: OwnedAgent,
  action: AgentQuoteAction,
): void {
  if (action === "trade") {
    assertTradeEnabled(agent);
    return;
  }
  if (action === "back") {
    assertBackEnabled(agent);
    return;
  }
  const _exhaustive: never = action;
  void _exhaustive;
}

function assertBalance(
  quote: AgentTradeQuoteRecord,
  balance: UniversalBalance,
): void {
  if (balance.totalUsd + 1e-9 < quote.dollarsIn) {
    throw new AgentExecuteError(
      "insufficient_balance",
      `Unified balance $${balance.totalUsd.toFixed(2)} is below the quoted debit of $${quote.dollarsIn.toFixed(2)}.`,
      { quoteId: quote.quoteId },
    );
  }
}

function toAgreedQuote(record: AgentTradeQuoteRecord): TradeQuote {
  return {
    dollarsIn: record.dollarsIn,
    dollarsOut: record.dollarsOut,
    feeUsd: record.feeUsd,
    etaSeconds: 45,
    floorUsd: record.floorUsd,
    sourceChain: record.sourceChain,
    destChain: record.destChain,
    toAsset: record.toAsset,
    ...(record.receivedSymbol ? { receivedSymbol: record.receivedSymbol } : {}),
    transactionId: record.transactionId,
    rawTransaction: record.rawTransaction,
  };
}

function parsePermitInput(input: {
  quoteId: string;
  idempotencyKey: string;
  leaseId: string;
}): { quoteId: string; idempotencyKey: string; leaseId: string } {
  const quoteId = typeof input.quoteId === "string" ? input.quoteId.trim() : "";
  const idempotencyKey =
    typeof input.idempotencyKey === "string"
      ? input.idempotencyKey.trim()
      : "";
  const leaseId = typeof input.leaseId === "string" ? input.leaseId.trim() : "";
  if (!quoteId) {
    throw invalidInput(
      "quoteId",
      "required",
      "Provide the quoteId returned by conviction_quote_trade.",
    );
  }
  if (!idempotencyKey) {
    throw invalidInput(
      "idempotencyKey",
      "required",
      "Provide a durable idempotencyKey for this execution.",
    );
  }
  if (!leaseId) {
    throw invalidInput(
      "leaseId",
      "required",
      "Provide the active MCP leaseId for this process.",
    );
  }
  return { quoteId, idempotencyKey, leaseId };
}

const permitQuoteLocks = new Map<string, Promise<unknown>>();
const permitIdemLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prior.catch(() => undefined).then(() => gate);
  locks.set(key, chained);
  await prior.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}

/**
 * Atomically validate policy/lease/quote/budget, claim the quote, reserve
 * spend, and issue a single-use execution permit (ADR 0020). Never signs.
 * Supports trade and back quotes; action policy follows the stored quote.
 */
export async function issueTradeExecutionPermit(options: {
  agent: OwnedAgent;
  quoteId: string;
  idempotencyKey: string;
  leaseId: string;
  activeLeaseId: string | null;
  quoteStore: AgentQuoteStore;
  permitStore: AgentPermitStore;
  idempotencyStore: AgentIdempotencyStore;
  executionFinalityStore?: ExecutionFinalityStore;
  executionWorkflow?: ExecutionWorkflowStarter;
  executionReconciler?: ExecutionReconciler;
  balance: UniversalBalance;
  spendLedger?: AgentSpendLedger;
  /** When set, only quotes with this action may receive a permit. */
  expectedAction?: AgentQuoteAction;
  now?: () => Date;
  randomId?: () => string;
}): Promise<IssuePermitResult | AgentExecuteSuccess> {
  let parsed: { quoteId: string; idempotencyKey: string; leaseId: string };
  try {
    parsed = parsePermitInput(options);
  } catch (error) {
    if (error instanceof AgentExecuteError) return error.toBody();
    throw error;
  }

  const idemKey = `${options.agent.agentId}\0${parsed.idempotencyKey}`;
  return withLock(permitIdemLocks, idemKey, async () => {
    // ADR 0048: authentication / MCP lease before idempotent results.
    if (!options.activeLeaseId || options.activeLeaseId !== parsed.leaseId) {
      return {
        ok: false,
        code: "unavailable",
        message:
          "The MCP lease is no longer valid. Restart the server to reconnect.",
      };
    }

    if (options.executionFinalityStore) {
      const execution =
        await options.executionFinalityStore.getByAgentIdempotency(
          options.agent.agentId,
          parsed.idempotencyKey,
        );
      if (execution) {
        if (execution.quoteId !== parsed.quoteId) {
          return {
            ok: false,
            code: "quote_mismatch",
            message:
              "idempotencyKey is already bound to another execution quote.",
            quoteId: parsed.quoteId,
          };
        }
        if (
          options.executionWorkflow &&
          options.agent.address
        ) {
          const current = await advanceExistingExecution({
            record: execution,
            store: options.executionFinalityStore,
            workflow: options.executionWorkflow,
            ownerAddress: options.agent.address,
            ...(options.executionReconciler
              ? { reconcile: options.executionReconciler }
              : {}),
            ...(options.now ? { now: options.now } : {}),
          });
          return current.settlementResult ?? executionPendingResult(current);
        }
        return executionPendingResult(execution);
      }
    }

    const prior = await options.idempotencyStore.get(
      options.agent.agentId,
      parsed.idempotencyKey,
    );
    if (prior) return prior;

    const spendLedger = options.spendLedger ?? new MemorySpendLedger();
    const now = options.now?.() ?? new Date();

    const existingPermit = await options.permitStore.getByIdempotency(
      options.agent.agentId,
      parsed.idempotencyKey,
    );
    if (existingPermit) {
      if (existingPermit.status === "issued") {
        if (new Date(existingPermit.expiresAt).getTime() <= now.getTime()) {
          // ADR 0020: unused expired permits must release their reservation.
          const released = await options.permitStore.casStatus(
            existingPermit.permitId,
            "issued",
            "released",
          );
          if (released) {
            await spendLedger.release(
              options.agent.agentId,
              existingPermit.dollarsIn,
            );
          }
        } else if (existingPermit.leaseId !== parsed.leaseId) {
          return {
            ok: false,
            code: "unavailable",
            message:
              "The MCP lease is no longer valid. Restart the server to reconnect.",
          };
        } else {
          return permitResponse(existingPermit);
        }
      }
    }

    try {
      assertExecuteLifecycle(options.agent);
      // ADR 0048: when the caller declares the action, policy precedes quote lookup.
      if (options.expectedAction) {
        assertActionEnabled(options.agent, options.expectedAction);
      }

      return await withLock(
        permitQuoteLocks,
        `${options.agent.agentId}\0${parsed.quoteId}`,
        async () => {
          const again = await options.idempotencyStore.get(
            options.agent.agentId,
            parsed.idempotencyKey,
          );
          if (again) return again;

          const preview = await options.quoteStore.get(parsed.quoteId);
          if (!preview || preview.agentId !== options.agent.agentId) {
            return maybePersist(
              options.idempotencyStore,
              options.agent.agentId,
              parsed.idempotencyKey,
              {
                ok: false,
                code: "quote_not_found",
                message: "No quote matches that quoteId for this agent.",
                quoteId: parsed.quoteId,
              },
            );
          }

          if (
            options.expectedAction &&
            preview.action !== options.expectedAction
          ) {
            return maybePersist(
              options.idempotencyStore,
              options.agent.agentId,
              parsed.idempotencyKey,
              {
                ok: false,
                code: "quote_mismatch",
                message:
                  options.expectedAction === "back"
                    ? "That quoteId is not a back quote. Call conviction_quote_back first."
                    : "That quoteId is not a trade quote. Call conviction_quote_trade first.",
                quoteId: parsed.quoteId,
              },
            );
          }

          if (!options.expectedAction) {
            assertActionEnabled(options.agent, preview.action);
          }

          const quote =
            preview.action === "back"
              ? await loadBackQuoteForExecute(options.quoteStore, {
                  quoteId: parsed.quoteId,
                  agentId: options.agent.agentId,
                  ...(options.now ? { now: options.now } : {}),
                })
              : await loadTradeQuoteForExecute(options.quoteStore, {
                  quoteId: parsed.quoteId,
                  agentId: options.agent.agentId,
                  ...(options.now ? { now: options.now } : {}),
                });

          assertBalance(quote, options.balance);

          if (quote.dollarsIn > options.agent.maxTradeUsd + 1e-9) {
            return maybePersist(
              options.idempotencyStore,
              options.agent.agentId,
              parsed.idempotencyKey,
              {
                ok: false,
                code: "spend_limit_exceeded",
                message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds the per-trade limit of $${options.agent.maxTradeUsd.toFixed(2)}.`,
                quoteId: quote.quoteId,
              },
            );
          }

          const reserved = await spendLedger.tryReserve({
            agentId: options.agent.agentId,
            dollarsIn: quote.dollarsIn,
            maxTradeUsd: options.agent.maxTradeUsd,
            spendBudgetUsd: options.agent.spendBudgetUsd,
            lifetimeSpendUsd: options.agent.lifetimeSpendUsd,
          });
          if (!reserved) {
            const remaining = await spendLedger.remainingUsd(
              options.agent.agentId,
              options.agent.spendBudgetUsd,
              options.agent.lifetimeSpendUsd,
            );
            // Remaining-budget failures are not durable — reservations may free.
            return {
              ok: false,
              code: "spend_limit_exceeded",
              message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds remaining spend budget of $${remaining.toFixed(2)}.`,
              quoteId: quote.quoteId,
            };
          }

          // ADR 0020: claim before any signing side effect.
          const claimed = await options.quoteStore.markUsed(quote.quoteId);
          if (!claimed) {
            await spendLedger.release(options.agent.agentId, quote.dollarsIn);
            return maybePersist(
              options.idempotencyStore,
              options.agent.agentId,
              parsed.idempotencyKey,
              {
                ok: false,
                code: "quote_mismatch",
                message: "That quote has already been consumed.",
                quoteId: quote.quoteId,
              },
            );
          }

          const permitId = options.randomId?.() ?? randomUUID();
          const quoteExpiry = new Date(quote.expiresAt).getTime();
          const permitExpiry = Math.min(
            now.getTime() + EXECUTION_PERMIT_TTL_MS,
            quoteExpiry,
          );
          const agreedQuote = toAgreedQuote(quote);

          const record: ExecutionPermitRecord = {
            permitId,
            agentId: options.agent.agentId,
            leaseId: parsed.leaseId,
            quoteId: quote.quoteId,
            quoteFingerprint: quote.quoteFingerprint,
            idempotencyKey: parsed.idempotencyKey,
            action: quote.action,
            dollarsIn: quote.dollarsIn,
            floorUsd: quote.floorUsd,
            intent: quote.intent,
            sizeUsd: quote.sizeUsd,
            agreedQuote,
            rawTransaction: quote.rawTransaction,
            issuedAt: now.toISOString(),
            expiresAt: new Date(permitExpiry).toISOString(),
            status: "issued",
            ...(quote.entryId ? { entryId: quote.entryId } : {}),
          };
          try {
            await options.permitStore.save(record);
          } catch (error) {
            await spendLedger.release(options.agent.agentId, quote.dollarsIn);
            // Quote is already claimed — surface unavailable without sticky store
            // when persistence itself failed (may be transient).
            return {
              ok: false,
              code: "unavailable",
              message:
                error instanceof Error
                  ? error.message
                  : "Could not persist the execution permit.",
              quoteId: quote.quoteId,
            };
          }

          return permitResponse(record);
        },
      );
    } catch (error) {
      if (error instanceof AgentExecuteError) {
        return maybePersist(
          options.idempotencyStore,
          options.agent.agentId,
          parsed.idempotencyKey,
          error.toBody(),
        );
      }
      if (error instanceof AgentQuoteError) {
        const code = error.code;
        if (
          code === "quote_not_found" ||
          code === "quote_expired" ||
          code === "quote_mismatch"
        ) {
          return maybePersist(
            options.idempotencyStore,
            options.agent.agentId,
            parsed.idempotencyKey,
            {
              ok: false,
              code,
              message: error.message,
              quoteId: parsed.quoteId,
            },
          );
        }
      }
      // Transient unavailable — not durable.
      return {
        ok: false,
        code: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Could not issue an execution permit.",
        quoteId: parsed.quoteId,
      };
    }
  });
}

/**
 * Submit pre-signed Particle payloads under an issued permit.
 * Consumes the permit, persists the receipt, and reconciles reserved spend.
 */
export async function submitSignedTradeExecution(options: {
  agent: OwnedAgent;
  input: SubmitSignedTradeInput;
  permitStore: AgentPermitStore;
  idempotencyStore: AgentIdempotencyStore;
  receipts: AgentReceiptPersist;
  quoteStore: AgentQuoteStore;
  tradeReceipts?: AgentTradeReceiptStore;
  /** Required for back permits — durable receipt + attribution (ADR 0028). */
  backStore?: AgentBackRecordStore;
  startBackWorkflow?: BackWorkflowStarter;
  attributeBack?: BackAttributionApplier;
  send: SignedTradeSender;
  /** Enables the confirmed-finality path. Required by the production route. */
  executionFinalityStore?: ExecutionFinalityStore;
  executionWorkflow?: ExecutionWorkflowStarter;
  /** Optional synchronous first read; the durable workflow remains canonical. */
  executionReconciler?: ExecutionReconciler;
  workflowCorrelationId?: string | null;
  activeLeaseId: string | null;
  spendLedger?: AgentSpendLedger;
  onSpend?: (dollarsIn: number) => void | Promise<void>;
  /**
   * Reload backend-authoritative agent policy immediately before claiming the
   * permit so disable/cap/action changes take effect even for outstanding permits.
   */
  reloadAgent?: () => Promise<OwnedAgent>;
  now?: () => Date;
  randomId?: () => string;
}): Promise<AgentExecuteResult> {
  const permitId =
    typeof options.input.permitId === "string"
      ? options.input.permitId.trim()
      : "";
  const idempotencyKey =
    typeof options.input.idempotencyKey === "string"
      ? options.input.idempotencyKey.trim()
      : "";
  const leaseId =
    typeof options.input.leaseId === "string"
      ? options.input.leaseId.trim()
      : "";
  const rootHashSignature =
    typeof options.input.rootHashSignature === "string"
      ? options.input.rootHashSignature.trim()
      : "";

  if (!permitId) {
    return invalidInput(
      "permitId",
      "required",
      "Provide the permitId returned by the execution permit endpoint.",
    ).toBody();
  }
  if (!idempotencyKey) {
    return invalidInput(
      "idempotencyKey",
      "required",
      "Provide the same idempotencyKey used to obtain the permit.",
    ).toBody();
  }
  if (!leaseId) {
    return invalidInput(
      "leaseId",
      "required",
      "Provide the active MCP leaseId for this process.",
    ).toBody();
  }
  const idemKey = `${options.agent.agentId}\0${idempotencyKey}`;
  return withLock(permitIdemLocks, idemKey, async () => {
    // ADR 0048: lease before idempotent results.
    if (!options.activeLeaseId || options.activeLeaseId !== leaseId) {
      return {
        ok: false,
        code: "unavailable",
        message:
          "The MCP lease is no longer valid. Restart the server to reconnect.",
      };
    }

    if (options.executionFinalityStore) {
      const execution =
        await options.executionFinalityStore.getByAgentIdempotency(
          options.agent.agentId,
          idempotencyKey,
        );
      if (execution) {
        if (execution.permitId !== permitId) {
          return {
            ok: false,
            code: "quote_mismatch",
            message:
              "idempotencyKey is already bound to another execution permit.",
            quoteId: execution.quoteId,
          };
        }
        if (options.executionWorkflow && options.agent.address) {
          const current = await advanceExistingExecution({
            record: execution,
            store: options.executionFinalityStore,
            workflow: options.executionWorkflow,
            ownerAddress: options.agent.address,
            ...(options.executionReconciler
              ? { reconcile: options.executionReconciler }
              : {}),
            ...(options.now ? { now: options.now } : {}),
          });
          return settleExecutionFinality({
            ...options,
            record: current,
            executionFinalityStore: options.executionFinalityStore,
          });
        }
        return executionPendingResult(execution);
      }
    }

    if (!rootHashSignature.startsWith("0x")) {
      return invalidInput(
        "rootHashSignature",
        "required",
        "Provide the local rootHash signature for this permit.",
      ).toBody();
    }

    const prior = await options.idempotencyStore.get(
      options.agent.agentId,
      idempotencyKey,
    );
    if (prior) {
      // Heal a missing publishable trade receipt after a prior secondary-save failure.
      if (prior.ok && options.tradeReceipts) {
        const permit = await options.permitStore.get(permitId);
        if (
          permit &&
          permit.agentId === options.agent.agentId &&
          permit.action === "trade"
        ) {
          try {
            await ensurePublishableTradeReceipt({
              agentId: options.agent.agentId,
              permit,
              receipt: prior.receipt,
              entryAt: (options.now?.() ?? new Date()).toISOString(),
              quoteStore: options.quoteStore,
              tradeReceipts: options.tradeReceipts,
            });
          } catch {
            // Keep returning the durable execute success; publish may still fail
            // until reconciliation succeeds.
          }
        }
      }
      // Heal a missing back record after secondary-save failure (ADR 0028).
      if (
        prior.ok &&
        options.backStore &&
        options.startBackWorkflow &&
        !prior.backRecordId
      ) {
        const permit = await options.permitStore.get(permitId);
        if (
          permit &&
          permit.agentId === options.agent.agentId &&
          permit.action === "back" &&
          permit.entryId
        ) {
          try {
            return await commitBackExecution({
              agent: options.agent,
              execute: prior,
              entryId: permit.entryId,
              backStore: options.backStore,
              idempotencyStore: options.idempotencyStore,
              startWorkflow: options.startBackWorkflow,
              ...(options.attributeBack
                ? { attributeNow: options.attributeBack }
                : {}),
              ...(options.now ? { now: options.now } : {}),
              ...(options.randomId ? { randomId: options.randomId } : {}),
            });
          } catch {
            // Keep returning durable execute success.
          }
        }
      }
      return prior;
    }

    const persist = async (
      result: AgentExecuteResult,
    ): Promise<AgentExecuteResult> => {
      if (result.ok || isDurablePermitError(result.code)) {
        await options.idempotencyStore.save(
          options.agent.agentId,
          idempotencyKey,
          result,
        );
      } else if (result.code === "unavailable") {
        // Pending / uncertain submissions must be durable so retries do not resign.
        await options.idempotencyStore.save(
          options.agent.agentId,
          idempotencyKey,
          result,
        );
      }
      return result;
    };

    const permit = await options.permitStore.get(permitId);
    if (!permit || permit.agentId !== options.agent.agentId) {
      return {
        ok: false,
        code: "unavailable",
        message: "Execution permit not found.",
      };
    }
    if (permit.idempotencyKey !== idempotencyKey) {
      return maybePersist(
        options.idempotencyStore,
        options.agent.agentId,
        idempotencyKey,
        {
          ok: false,
          code: "quote_mismatch",
          message: "idempotencyKey does not match the issued permit.",
          quoteId: permit.quoteId,
        },
      );
    }
    if (permit.leaseId !== leaseId) {
      return {
        ok: false,
        code: "unavailable",
        message:
          "The MCP lease is no longer valid for this permit. Restart the server to reconnect.",
        quoteId: permit.quoteId,
      };
    }

    const now = options.now?.() ?? new Date();
    if (permit.status === "pending") {
      return persist({
        ok: false,
        code: "unavailable",
        message:
          "A prior submission for this permit is pending reconciliation. Do not resign or resubmit a new transaction.",
        quoteId: permit.quoteId,
      });
    }
    if (permit.status !== "issued") {
      // Re-read idempotency — a concurrent winner may have stored success.
      const again = await options.idempotencyStore.get(
        options.agent.agentId,
        idempotencyKey,
      );
      if (again) return again;
      return {
        ok: false,
        code: "unavailable",
        message: "That execution permit has already been consumed.",
        quoteId: permit.quoteId,
      };
    }

    // ADR 0021 / 0022: re-check authoritative policy before claiming. Idempotent
    // successes above already returned; outstanding issued permits must not
    // outlive disablement, cap, or action disable.
    let agentForPolicy = options.agent;
    if (options.reloadAgent) {
      try {
        agentForPolicy = await options.reloadAgent();
      } catch (error) {
        if (error instanceof AgentExecuteError) {
          return {
            ...error.toBody(),
            quoteId: permit.quoteId,
          };
        }
        throw error;
      }
    }
    try {
      assertExecuteLifecycle(agentForPolicy);
      assertTradeEnabled(agentForPolicy);
    } catch (error) {
      if (error instanceof AgentExecuteError) {
        const released = await options.permitStore.casStatus(
          permitId,
          "issued",
          "released",
        );
        if (released) {
          await options.spendLedger?.release(
            options.agent.agentId,
            permit.dollarsIn,
          );
        }
        // Non-sticky: operator may re-enable and the host must obtain a new permit.
        return {
          ...error.toBody(),
          quoteId: permit.quoteId,
        };
      }
      throw error;
    }

    if (new Date(permit.expiresAt).getTime() <= now.getTime()) {
      const released = await options.permitStore.casStatus(
        permitId,
        "issued",
        "released",
      );
      if (released) {
        await options.spendLedger?.release(
          options.agent.agentId,
          permit.dollarsIn,
        );
      }
      return maybePersist(
        options.idempotencyStore,
        options.agent.agentId,
        idempotencyKey,
        {
          ok: false,
          code: "quote_expired",
          message:
            permit.action === "back"
              ? "The execution permit expired before submission. Call conviction_quote_back for a new quoteId."
              : "The execution permit expired before submission. Call conviction_quote_trade for a new quoteId.",
          quoteId: permit.quoteId,
        },
      );
    }

    const raw = permit.rawTransaction as RawTransaction;
    if (!raw?.rootHash || !options.agent.address) {
      return {
        ok: false,
        code: "unavailable",
        message: "Execution permit is missing a signable rootHash.",
        quoteId: permit.quoteId,
      };
    }
    if (
      options.executionFinalityStore &&
      !raw.transactionId?.trim()
    ) {
      return {
        ok: false,
        code: "unavailable",
        message:
          "Stored execution payload is missing its planned Particle transaction identity.",
        quoteId: permit.quoteId,
      };
    }
    try {
      assertTradeDebitWithinCeiling(
        raw.tokenChanges ?? {},
        permit.agreedQuote.dollarsIn,
      );
    } catch (error) {
      const released = await options.permitStore.casStatus(
        permitId,
        "issued",
        "released",
      );
      if (released) {
        await options.spendLedger?.release(
          options.agent.agentId,
          permit.dollarsIn,
        );
      }
      return maybePersist(
        options.idempotencyStore,
        options.agent.agentId,
        idempotencyKey,
        {
          ok: false,
          code: "quote_mismatch",
          message:
            error instanceof Error
              ? error.message
              : "Stored transaction debit does not match the authorized quote.",
          quoteId: permit.quoteId,
        },
      );
    }
    try {
      const recovered = verifyMessage(getBytes(raw.rootHash), rootHashSignature);
      if (getAddress(recovered) !== getAddress(options.agent.address)) {
        return invalidInput(
          "rootHashSignature",
          "invalid_signature",
          "rootHashSignature does not recover to this agent's signer address.",
        ).toBody();
      }
    } catch {
      return invalidInput(
        "rootHashSignature",
        "invalid_signature",
        "rootHashSignature is not a valid signature over the permit rootHash.",
      ).toBody();
    }

    // Claim permit before provider side effects so concurrent submits cannot both send.
    // Include expiry in the race window by re-checking status+time via CAS only.
    const claimed = await options.permitStore.casStatus(
      permitId,
      "issued",
      "consumed",
    );
    if (!claimed) {
      const again = await options.idempotencyStore.get(
        options.agent.agentId,
        idempotencyKey,
      );
      if (again) return again;
      // Do not durable-persist a CAS-loser failure — the winner may still succeed.
      return {
        ok: false,
        code: "unavailable",
        message:
          "Another submission is in progress for this permit. Retry shortly.",
        quoteId: permit.quoteId,
      };
    }

    let execution: ExecutionFinalityRecord | null = null;
    if (options.executionFinalityStore) {
      try {
        execution = await options.executionFinalityStore.create(
          createPreSubmissionExecution({
            executionId: options.randomId?.() ?? randomUUID(),
            agentId: options.agent.agentId,
            permitId: permit.permitId,
            quoteId: permit.quoteId,
            idempotencyKey,
            rawTransaction: raw,
            correlationId: options.workflowCorrelationId,
            createdAt: now.toISOString(),
          }),
        );
      } catch (error) {
        await options.permitStore.casStatus(permitId, "consumed", "pending");
        return {
          ok: false,
          code: "unavailable",
          message:
            error instanceof Error
              ? `Execution was claimed but its finality record could not be prepared: ${error.message}`
              : "Execution was claimed but its finality record could not be prepared.",
          quoteId: permit.quoteId,
        };
      }

      if (!options.executionWorkflow) {
        await options.permitStore.casStatus(permitId, "consumed", "pending");
        return executionPendingResult(execution, permit.action);
      }
      try {
        const started = await options.executionWorkflow.start(
          execution.executionId,
          options.agent.address,
        );
        execution = await attachExecutionWorkflowRun({
          store: options.executionFinalityStore,
          executionId: execution.executionId,
          runId: started.runId,
          at: now.toISOString(),
        });
      } catch (error) {
        await options.permitStore.casStatus(permitId, "consumed", "pending");
        execution = await markExecutionSubmissionUncertain({
          store: options.executionFinalityStore,
          executionId: execution.executionId,
          error:
            error instanceof Error
              ? new Error(
                  `Submission was not attempted because finality workflow start failed: ${error.message}`,
                )
              : new Error(
                  "Submission was not attempted because finality workflow start failed.",
                ),
          at: now.toISOString(),
        });
        return executionPendingResult(execution, permit.action);
      }
    }

    const receiptSlug =
      options.randomId?.() ??
      `rcpt_${permit.quoteId.replace(/-/g, "").slice(0, 12)}`;

    let sendResult: Awaited<ReturnType<SignedTradeSender>>;
    try {
      sendResult = await options.send({
        rawTransaction: raw,
        rootHashSignature,
        ...(options.input.authorizations
          ? { authorizations: options.input.authorizations }
          : {}),
        agreedQuote: permit.agreedQuote,
        intent: permit.intent,
        sizeUsd: permit.sizeUsd,
        receiptSlug,
      });
    } catch (error) {
      // Uncertain whether the provider accepted the signed payload — record pending.
      await options.permitStore.casStatus(permitId, "consumed", "pending");
      if (execution && options.executionFinalityStore) {
        execution = await markExecutionSubmissionUncertain({
          store: options.executionFinalityStore,
          executionId: execution.executionId,
          error,
          at: (options.now?.() ?? new Date()).toISOString(),
        });
        return executionPendingResult(execution, permit.action);
      }
      return persist({
        ok: false,
        code: "unavailable",
        message:
          error instanceof Error
            ? `Trade submission is uncertain and recorded for reconciliation: ${error.message}`
            : "Trade submission is uncertain and recorded for reconciliation.",
        quoteId: permit.quoteId,
      });
    }

    if (sendResult.uncertain) {
      await options.permitStore.casStatus(permitId, "consumed", "pending");
      if (execution && options.executionFinalityStore) {
        execution = await markExecutionSubmissionUncertain({
          store: options.executionFinalityStore,
          executionId: execution.executionId,
          error: new Error(
            "Particle returned an uncertain submission response.",
          ),
          at: (options.now?.() ?? new Date()).toISOString(),
        });
        return executionPendingResult(execution, permit.action);
      }
      return persist({
        ok: false,
        code: "unavailable",
        message:
          "Trade submission is uncertain and recorded for reconciliation. Do not resign or submit another transaction.",
        quoteId: permit.quoteId,
      });
    }

    if (execution && options.executionFinalityStore) {
      execution = await markExecutionSubmitted({
        store: options.executionFinalityStore,
        executionId: execution.executionId,
        transactionId: sendResult.transactionId,
        at: (options.now?.() ?? new Date()).toISOString(),
      });
      await options.permitStore.casStatus(permitId, "consumed", "pending");
      if (
        options.executionReconciler &&
        execution.outcome !== "partial" &&
        execution.outcome !== "failed" &&
        execution.outcome !== "needs_attention"
      ) {
        execution = await options.executionReconciler.reconcile(
          execution.executionId,
        );
      }
      return settleExecutionFinality({
        ...options,
        record: execution,
        executionFinalityStore: options.executionFinalityStore,
      });
    }

    if (!sendResult.receipt || !sendResult.summary) {
      return {
        ok: false,
        code: "unavailable",
        message: "Execution submission did not return a legacy receipt.",
        quoteId: permit.quoteId,
      };
    }

    const countedDebitUsd = sendResult.receipt.dollarsIn;
    const success: AgentExecuteSuccess = {
      ok: true,
      receiptId: sendResult.receipt.slug,
      quoteId: permit.quoteId,
      quoteFingerprint: permit.quoteFingerprint,
      transactionId: sendResult.transactionId,
      summary: sendResult.summary,
      receipt: sendResult.receipt,
      dollarsIn: countedDebitUsd,
      dollarsOut: sendResult.receipt.dollarsOut,
      feeUsd: sendResult.receipt.feeUsd,
      idempotencyKey,
      action: permit.action,
      ...(permit.entryId ? { entryId: permit.entryId } : {}),
    };

    // Persist success before secondary accounting so a concurrent loser cannot
    // sticky-fail the idempotency key after funds moved.
    await options.idempotencyStore.save(
      options.agent.agentId,
      idempotencyKey,
      success,
    );

    try {
      await options.onSpend?.(countedDebitUsd);
      await options.receipts.save(sendResult.receipt);
      await options.spendLedger?.commit(
        options.agent.agentId,
        permit.dollarsIn,
      );
      if (permit.action === "trade" && options.tradeReceipts) {
        await ensurePublishableTradeReceipt({
          agentId: options.agent.agentId,
          permit,
          receipt: sendResult.receipt,
          entryAt: now.toISOString(),
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
        // Receipt + back record before attribution (ADR 0028).
        return await commitBackExecution({
          agent: options.agent,
          execute: success,
          entryId: permit.entryId,
          backStore: options.backStore,
          idempotencyStore: options.idempotencyStore,
          startWorkflow: options.startBackWorkflow,
          ...(options.attributeBack
            ? { attributeNow: options.attributeBack }
            : {}),
          ...(options.now ? { now: options.now } : {}),
          ...(options.randomId ? { randomId: options.randomId } : {}),
        });
      }
    } catch {
      // On-chain send already succeeded. Keep durable success; mark pending for
      // reconciliation of receipt / lifetime spend / reservation release.
      // Authenticated retries heal a missing publishable trade receipt above.
      await options.permitStore.casStatus(permitId, "consumed", "pending");

      // Prefer returning back fields when the durable record can still be saved.
      if (
        permit.action === "back" &&
        permit.entryId &&
        options.backStore &&
        options.startBackWorkflow
      ) {
        try {
          return await commitBackExecution({
            agent: options.agent,
            execute: success,
            entryId: permit.entryId,
            backStore: options.backStore,
            idempotencyStore: options.idempotencyStore,
            startWorkflow: options.startBackWorkflow,
            ...(options.attributeBack
              ? { attributeNow: options.attributeBack }
              : {}),
            ...(options.now ? { now: options.now } : {}),
            ...(options.randomId ? { randomId: options.randomId } : {}),
          });
        } catch {
          // Fall through to bare execute success; heal path on retry.
        }
      }
    }

    return success;
  });
}

export function executeErrorStatus(
  code: AgentExecuteErrorBody["code"],
): number {
  switch (code) {
    case "quote_not_found":
      return 404;
    case "lifecycle_blocked":
    case "action_disabled":
    case "quote_expired":
    case "quote_mismatch":
    case "price_floor_breached":
    case "insufficient_balance":
    case "spend_limit_exceeded":
      return 409;
    case "invalid_input":
      return 422;
    case "unavailable":
      return 503;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
