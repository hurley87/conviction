// Policy-bounded trade execution — quote-before-execute, ADR 0040 / 0048.
// Consumes a stored quote ID only; never silently requotes or substitutes terms.
// Claim + spend reservation happen before any provider/sign side effect (ADR 0020).

import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  AgentQuoteError,
  loadTradeQuoteForExecute,
  type AgentQuoteStore,
  type AgentTradeQuoteRecord,
} from "@/lib/agent-quote";
import { mockTradeSigners } from "@/lib/ua/mock";
import type { UAClient } from "@/lib/ua/types";
import type {
  Receipt,
  TradeQuote,
  TradeSigners,
  UniversalBalance,
} from "@/lib/verbs/types";
import { FloorAbortError } from "@/lib/verbs/types";

export type AgentExecuteTradeInput = {
  quoteId: string;
  idempotencyKey: string;
};

export type AgentExecuteSuccess = {
  ok: true;
  receiptId: string;
  quoteId: string;
  quoteFingerprint: string;
  transactionId: string;
  summary: string;
  receipt: Receipt;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  idempotencyKey: string;
};

export type AgentExecuteErrorCode =
  | "invalid_input"
  | "lifecycle_blocked"
  | "action_disabled"
  | "quote_not_found"
  | "quote_expired"
  | "quote_mismatch"
  | "insufficient_balance"
  | "spend_limit_exceeded"
  | "price_floor_breached"
  | "unavailable";

export type AgentExecuteErrorBody = {
  ok: false;
  code: AgentExecuteErrorCode;
  message: string;
  action?: "trade";
  quoteId?: string;
  fields?: Array<{ field: string; code: string; message: string }>;
};

export type AgentExecuteResult = AgentExecuteSuccess | AgentExecuteErrorBody;

export type AgentIdempotencyStore = {
  get(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentExecuteResult | null>;
  save(
    agentId: string,
    idempotencyKey: string,
    result: AgentExecuteResult,
  ): Promise<void>;
};

/** In-memory idempotency ledger for tests and offline mock paths. */
export class MemoryAgentIdempotencyStore implements AgentIdempotencyStore {
  private readonly results = new Map<string, AgentExecuteResult>();

  private key(agentId: string, idempotencyKey: string): string {
    return `${agentId}\0${idempotencyKey}`;
  }

  async get(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentExecuteResult | null> {
    return this.results.get(this.key(agentId, idempotencyKey)) ?? null;
  }

  async save(
    agentId: string,
    idempotencyKey: string,
    result: AgentExecuteResult,
  ): Promise<void> {
    const key = this.key(agentId, idempotencyKey);
    const existing = this.results.get(key);
    // Success always wins; never overwrite a durable success with a failure
    // (multi-instance race: CAS loser must not sticky-fail after a winner sends).
    if (existing?.ok) return;
    if (result.ok || !existing) {
      this.results.set(key, structuredClone(result));
    }
  }

  /** Snapshot for restart / durability tests. */
  exportAll(): Array<{
    agentId: string;
    idempotencyKey: string;
    result: AgentExecuteResult;
  }> {
    return [...this.results.entries()].map(([raw, result]) => {
      const separator = raw.indexOf("\0");
      return {
        agentId: raw.slice(0, separator),
        idempotencyKey: raw.slice(separator + 1),
        result: structuredClone(result),
      };
    });
  }

  async importAll(
    entries: Array<{
      agentId: string;
      idempotencyKey: string;
      result: AgentExecuteResult;
    }>,
  ): Promise<void> {
    for (const entry of entries) {
      await this.save(entry.agentId, entry.idempotencyKey, entry.result);
    }
  }

  clear(): void {
    this.results.clear();
  }
}

export type AgentReceiptPersist = {
  save(receipt: Receipt): Promise<void>;
  get(
    receiptId: string,
  ): Promise<{ receipt: Receipt; entryAt: string } | null>;
};

/** In-memory receipt persistence for execute tests (no Neon). */
export class MemoryAgentReceiptPersist implements AgentReceiptPersist {
  private readonly records = new Map<
    string,
    { receipt: Receipt; entryAt: string }
  >();

  async save(receipt: Receipt): Promise<void> {
    this.records.set(receipt.slug, {
      receipt: structuredClone(receipt),
      entryAt: new Date().toISOString(),
    });
  }

  async get(
    receiptId: string,
  ): Promise<{ receipt: Receipt; entryAt: string } | null> {
    const stored = this.records.get(receiptId);
    return stored ? structuredClone(stored) : null;
  }

  clear(): void {
    this.records.clear();
  }
}

/**
 * Tracks active spend reservations so concurrent executes cannot both pass a
 * snapshot remaining-budget check (ADR 0020 / 0048).
 */
export class MemorySpendLedger {
  private readonly reservedByAgent = new Map<string, number>();

  reservedUsd(agentId: string): number {
    return this.reservedByAgent.get(agentId) ?? 0;
  }

  remainingUsd(
    agentId: string,
    spendBudgetUsd: number,
    lifetimeSpendUsd: number,
  ): number {
    return Math.max(
      0,
      spendBudgetUsd - lifetimeSpendUsd - this.reservedUsd(agentId),
    );
  }

  /** Reserve counted debit. Returns false when over max-trade or remaining budget. */
  tryReserve(input: {
    agentId: string;
    dollarsIn: number;
    maxTradeUsd: number;
    spendBudgetUsd: number;
    lifetimeSpendUsd: number;
  }): boolean {
    if (input.dollarsIn > input.maxTradeUsd + 1e-9) return false;
    const remaining = this.remainingUsd(
      input.agentId,
      input.spendBudgetUsd,
      input.lifetimeSpendUsd,
    );
    if (input.dollarsIn > remaining + 1e-9) return false;
    this.reservedByAgent.set(
      input.agentId,
      this.reservedUsd(input.agentId) + input.dollarsIn,
    );
    return true;
  }

  release(agentId: string, dollarsIn: number): void {
    const next = this.reservedUsd(agentId) - dollarsIn;
    if (next <= 1e-9) this.reservedByAgent.delete(agentId);
    else this.reservedByAgent.set(agentId, next);
  }

  /** Drop reservation after a successful counted debit (lifetime updated by caller). */
  commit(agentId: string, dollarsIn: number): void {
    this.release(agentId, dollarsIn);
  }

  clear(): void {
    this.reservedByAgent.clear();
  }
}

export class AgentExecuteError extends Error {
  constructor(
    public readonly code: AgentExecuteErrorCode,
    message: string,
    public readonly details: {
      action?: "trade";
      quoteId?: string;
      fields?: AgentExecuteErrorBody["fields"];
    } = {},
  ) {
    super(message);
    this.name = "AgentExecuteError";
  }

  toBody(): AgentExecuteErrorBody {
    return {
      ok: false,
      code: this.code,
      message: this.message,
      ...(this.details.action ? { action: this.details.action } : {}),
      ...(this.details.quoteId ? { quoteId: this.details.quoteId } : {}),
      ...(this.details.fields ? { fields: this.details.fields } : {}),
    };
  }
}

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

function parseExecuteInput(
  input: AgentExecuteTradeInput,
): AgentExecuteTradeInput {
  const quoteId =
    typeof input.quoteId === "string" ? input.quoteId.trim() : "";
  const idempotencyKey =
    typeof input.idempotencyKey === "string"
      ? input.idempotencyKey.trim()
      : "";
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
  return { quoteId, idempotencyKey };
}

const idempotencyInFlight = new Map<string, Promise<AgentExecuteResult>>();
const quoteInFlight = new Map<string, Promise<unknown>>();

function idemKey(agentId: string, idempotencyKey: string): string {
  return `${agentId}\0${idempotencyKey}`;
}

function quoteKey(agentId: string, quoteId: string): string {
  return `${agentId}\0quote\0${quoteId}`;
}

async function withQuoteLock<T>(
  agentId: string,
  quoteId: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = quoteKey(agentId, quoteId);
  const prior = quoteInFlight.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prior.catch(() => undefined).then(() => gate);
  quoteInFlight.set(key, chained);
  await prior.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (quoteInFlight.get(key) === chained) quoteInFlight.delete(key);
  }
}

/**
 * Execute a recent trade quote under ADR 0048 precedence.
 * Never silently requotes (ADR 0040). Claim + spend reservation occur before
 * any provider call (ADR 0020). Floor breaches consume the quote identity
 * (single-use attempt) but never store a replacement quote.
 */
export async function executeAgentTrade(options: {
  agent: OwnedAgent;
  input: AgentExecuteTradeInput;
  quoteStore: AgentQuoteStore;
  idempotencyStore: AgentIdempotencyStore;
  receipts: AgentReceiptPersist;
  ua: UAClient;
  balance: UniversalBalance;
  spendLedger?: MemorySpendLedger;
  signers?: TradeSigners;
  now?: () => Date;
  randomId?: () => string;
  /** Called after a successful counted debit so callers can persist lifetime spend. */
  onSpend?: (dollarsIn: number) => void | Promise<void>;
}): Promise<AgentExecuteResult> {
  let parsed: AgentExecuteTradeInput;
  try {
    parsed = parseExecuteInput(options.input);
  } catch (error) {
    if (error instanceof AgentExecuteError) return error.toBody();
    throw error;
  }

  const key = idemKey(options.agent.agentId, parsed.idempotencyKey);
  const existingFlight = idempotencyInFlight.get(key);
  if (existingFlight) return existingFlight;

  const run = runExecuteAgentTrade({
    ...options,
    input: parsed,
    spendLedger: options.spendLedger ?? new MemorySpendLedger(),
  });
  idempotencyInFlight.set(key, run);
  try {
    return await run;
  } finally {
    idempotencyInFlight.delete(key);
  }
}

async function runExecuteAgentTrade(options: {
  agent: OwnedAgent;
  input: AgentExecuteTradeInput;
  quoteStore: AgentQuoteStore;
  idempotencyStore: AgentIdempotencyStore;
  receipts: AgentReceiptPersist;
  ua: UAClient;
  balance: UniversalBalance;
  spendLedger: MemorySpendLedger;
  signers?: TradeSigners;
  now?: () => Date;
  randomId?: () => string;
  onSpend?: (dollarsIn: number) => void | Promise<void>;
}): Promise<AgentExecuteResult> {
  const prior = await options.idempotencyStore.get(
    options.agent.agentId,
    options.input.idempotencyKey,
  );
  if (prior) return prior;

  const persist = async (result: AgentExecuteResult): Promise<AgentExecuteResult> => {
    await options.idempotencyStore.save(
      options.agent.agentId,
      options.input.idempotencyKey,
      result,
    );
    return result;
  };

  try {
    assertExecuteLifecycle(options.agent);
    assertTradeEnabled(options.agent);

    return await withQuoteLock(
      options.agent.agentId,
      options.input.quoteId,
      async () => {
        // Re-check idempotency inside the quote lock in case a sibling finished.
        const again = await options.idempotencyStore.get(
          options.agent.agentId,
          options.input.idempotencyKey,
        );
        if (again) return again;

        const quote = await loadTradeQuoteForExecute(options.quoteStore, {
          quoteId: options.input.quoteId,
          agentId: options.agent.agentId,
          ...(options.now ? { now: options.now } : {}),
        });

        assertBalance(quote, options.balance);

        const reserved = options.spendLedger.tryReserve({
          agentId: options.agent.agentId,
          dollarsIn: quote.dollarsIn,
          maxTradeUsd: options.agent.maxTradeUsd,
          spendBudgetUsd: options.agent.spendBudgetUsd,
          lifetimeSpendUsd: options.agent.lifetimeSpendUsd,
        });
        if (!reserved) {
          const remaining = options.spendLedger.remainingUsd(
            options.agent.agentId,
            options.agent.spendBudgetUsd,
            options.agent.lifetimeSpendUsd,
          );
          if (quote.dollarsIn > options.agent.maxTradeUsd + 1e-9) {
            return persist({
              ok: false,
              code: "spend_limit_exceeded",
              message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds the per-trade limit of $${options.agent.maxTradeUsd.toFixed(2)}.`,
              quoteId: quote.quoteId,
            });
          }
          return persist({
            ok: false,
            code: "spend_limit_exceeded",
            message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds remaining spend budget of $${remaining.toFixed(2)}.`,
            quoteId: quote.quoteId,
          });
        }

        // ADR 0020: claim the quote before any provider/sign side effect.
        const claimed = await options.quoteStore.markUsed(quote.quoteId);
        if (!claimed) {
          options.spendLedger.release(options.agent.agentId, quote.dollarsIn);
          return persist({
            ok: false,
            code: "quote_mismatch",
            message: "That quote has already been consumed.",
            quoteId: quote.quoteId,
          });
        }

        const receiptSlug =
          options.randomId?.() ??
          `rcpt_${quote.quoteId.replace(/-/g, "").slice(0, 12)}`;
        const signers = options.signers ?? mockTradeSigners;

        let tradeResult;
        try {
          tradeResult = await options.ua.executeTrade({
            intent: quote.intent,
            sizeUsd: quote.sizeUsd,
            agreedQuote: toAgreedQuote(quote),
            signers,
            receiptSlug,
          });
        } catch (error) {
          options.spendLedger.release(options.agent.agentId, quote.dollarsIn);
          if (error instanceof FloorAbortError) {
            // Quote identity is consumed by the attempt; never store replacement terms.
            return persist({
              ok: false,
              code: "price_floor_breached",
              message:
                "Current execution cannot satisfy the quote's minimum-received floor. Call conviction_quote_trade for a new quoteId — execution never silently requotes.",
              quoteId: quote.quoteId,
            });
          }
          return persist({
            ok: false,
            code: "unavailable",
            message:
              error instanceof Error
                ? error.message
                : "Could not execute the trade quote.",
            quoteId: quote.quoteId,
          });
        }

        try {
          await options.receipts.save(tradeResult.receipt);
          await options.onSpend?.(quote.dollarsIn);
          options.spendLedger.commit(options.agent.agentId, quote.dollarsIn);
        } catch (error) {
          // Quote already claimed and provider succeeded — do not release for retry.
          options.spendLedger.commit(options.agent.agentId, quote.dollarsIn);
          return persist({
            ok: false,
            code: "unavailable",
            message:
              error instanceof Error
                ? error.message
                : "Trade executed but receipt persistence failed.",
            quoteId: quote.quoteId,
          });
        }

        return persist({
          ok: true,
          receiptId: tradeResult.receipt.slug,
          quoteId: quote.quoteId,
          quoteFingerprint: quote.quoteFingerprint,
          transactionId: tradeResult.transactionId,
          summary: tradeResult.summary,
          receipt: tradeResult.receipt,
          dollarsIn: quote.dollarsIn,
          dollarsOut: tradeResult.receipt.dollarsOut,
          feeUsd: tradeResult.receipt.feeUsd,
          idempotencyKey: options.input.idempotencyKey,
        });
      },
    );
  } catch (error) {
    if (error instanceof AgentExecuteError) {
      return persist(error.toBody());
    }
    if (error instanceof AgentQuoteError) {
      const code = error.code;
      if (
        code === "quote_not_found" ||
        code === "quote_expired" ||
        code === "quote_mismatch"
      ) {
        return persist({
          ok: false,
          code,
          message: error.message,
          quoteId: options.input.quoteId,
        });
      }
      if (code === "lifecycle_blocked") {
        return persist({
          ok: false,
          code: "lifecycle_blocked",
          message: error.message,
        });
      }
    }
    return persist({
      ok: false,
      code: "unavailable",
      message:
        error instanceof Error
          ? error.message
          : "Could not execute the trade quote.",
      quoteId: options.input.quoteId,
    });
  }
}
