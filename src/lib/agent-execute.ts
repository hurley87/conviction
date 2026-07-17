// Policy-bounded trade execution — quote-before-execute, ADR 0040 / 0048.
// Consumes a stored quote ID only; never silently requotes or substitutes terms.

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
    this.results.set(this.key(agentId, idempotencyKey), structuredClone(result));
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

function remainingBudgetUsd(agent: OwnedAgent): number {
  return Math.max(0, agent.spendBudgetUsd - agent.lifetimeSpendUsd);
}

function assertSpendAndBalance(
  agent: OwnedAgent,
  quote: AgentTradeQuoteRecord,
  balance: UniversalBalance,
): void {
  if (quote.dollarsIn > agent.maxTradeUsd + 1e-9) {
    throw new AgentExecuteError(
      "spend_limit_exceeded",
      `Trade size $${quote.dollarsIn.toFixed(2)} exceeds the per-trade limit of $${agent.maxTradeUsd.toFixed(2)}.`,
      { quoteId: quote.quoteId },
    );
  }
  const remaining = remainingBudgetUsd(agent);
  if (quote.dollarsIn > remaining + 1e-9) {
    throw new AgentExecuteError(
      "spend_limit_exceeded",
      `Trade size $${quote.dollarsIn.toFixed(2)} exceeds remaining spend budget of $${remaining.toFixed(2)}.`,
      { quoteId: quote.quoteId },
    );
  }
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

const inFlight = new Map<string, Promise<AgentExecuteResult>>();

function flightKey(agentId: string, idempotencyKey: string): string {
  return `${agentId}\0${idempotencyKey}`;
}

/**
 * Execute a recent trade quote under ADR 0048 precedence.
 * Never silently requotes (ADR 0040). Floor breaches do not persist a
 * replacement quote. Idempotent retries return the stored primary result.
 */
export async function executeAgentTrade(options: {
  agent: OwnedAgent;
  input: AgentExecuteTradeInput;
  quoteStore: AgentQuoteStore;
  idempotencyStore: AgentIdempotencyStore;
  receipts: AgentReceiptPersist;
  ua: UAClient;
  balance: UniversalBalance;
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

  const key = flightKey(options.agent.agentId, parsed.idempotencyKey);
  const existingFlight = inFlight.get(key);
  if (existingFlight) return existingFlight;

  const run = runExecuteAgentTrade({
    ...options,
    input: parsed,
  });
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
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

    const quote = await loadTradeQuoteForExecute(options.quoteStore, {
      quoteId: options.input.quoteId,
      agentId: options.agent.agentId,
      ...(options.now ? { now: options.now } : {}),
    });

    assertSpendAndBalance(options.agent, quote, options.balance);

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
      if (error instanceof FloorAbortError) {
        // ADR 0040: do not store or return the fresh quote as executable terms.
        return persist({
          ok: false,
          code: "price_floor_breached",
          message:
            "Current execution cannot satisfy the quote's minimum-received floor. Call conviction_quote_trade for a new quoteId — execution never silently requotes.",
          quoteId: quote.quoteId,
        });
      }
      throw error;
    }

    const claimed = await options.quoteStore.markUsed(quote.quoteId);
    if (!claimed) {
      return persist({
        ok: false,
        code: "quote_mismatch",
        message: "That quote has already been consumed.",
        quoteId: quote.quoteId,
      });
    }

    await options.receipts.save(tradeResult.receipt);
    await options.onSpend?.(quote.dollarsIn);

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
