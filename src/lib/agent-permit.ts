// Execution permits for MCP value-moving actions (ADR 0020 / 0040 / 0048).
// Quote alone never authorizes signing — MCP must obtain a live permit first.

import { randomUUID } from "node:crypto";

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
  AgentQuoteError,
  loadTradeQuoteForExecute,
  type AgentQuoteStore,
  type AgentTradeQuoteRecord,
} from "@/lib/agent-quote";
import type { UniversalBalance } from "@/lib/verbs/types";
import type { Receipt, TradeIntent, TradeQuote } from "@/lib/verbs/types";
import type { RawTransaction } from "@/lib/ua/trade";

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
  action: "trade";
  dollarsIn: number;
  floorUsd: number;
  intent: TradeIntent;
  sizeUsd: number;
  agreedQuote: TradeQuote;
  rawTransaction: unknown;
  issuedAt: string;
  expiresAt: string;
  status: ExecutionPermitStatus;
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
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
};

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
  receipt: Receipt;
  summary: string;
  uncertain?: boolean;
}>;

export type AgentPermitStore = {
  save(record: ExecutionPermitRecord): Promise<void>;
  get(permitId: string): Promise<ExecutionPermitRecord | null>;
  getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionPermitRecord | null>;
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
  balance: UniversalBalance;
  spendLedger?: AgentSpendLedger;
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
    const prior = await options.idempotencyStore.get(
      options.agent.agentId,
      parsed.idempotencyKey,
    );
    if (prior?.ok) return prior;
    if (prior && !prior.ok) return prior;

    const existingPermit = await options.permitStore.getByIdempotency(
      options.agent.agentId,
      parsed.idempotencyKey,
    );
    if (existingPermit && existingPermit.status === "issued") {
      const now = options.now?.() ?? new Date();
      if (new Date(existingPermit.expiresAt).getTime() > now.getTime()) {
        return {
          ok: true as const,
          permitId: existingPermit.permitId,
          quoteId: existingPermit.quoteId,
          quoteFingerprint: existingPermit.quoteFingerprint,
          dollarsIn: existingPermit.dollarsIn,
          floorUsd: existingPermit.floorUsd,
          expiresAt: existingPermit.expiresAt,
          intent: existingPermit.intent,
          sizeUsd: existingPermit.sizeUsd,
          agreedQuote: existingPermit.agreedQuote,
          rawTransaction: existingPermit.rawTransaction,
          transactionId: existingPermit.agreedQuote.transactionId,
          idempotencyKey: existingPermit.idempotencyKey,
        };
      }
    }

    try {
      // Lease mismatches are not durable idempotent outcomes — the operator may
      // reconnect and retry the same key under a fresh active lease.
      if (
        !options.activeLeaseId ||
        options.activeLeaseId !== parsed.leaseId
      ) {
        return {
          ok: false,
          code: "unavailable",
          message:
            "The MCP lease is no longer valid. Restart the server to reconnect.",
        };
      }

      assertExecuteLifecycle(options.agent);
      assertTradeEnabled(options.agent);

      return await withLock(
        permitQuoteLocks,
        `${options.agent.agentId}\0${parsed.quoteId}`,
        async () => {
          const again = await options.idempotencyStore.get(
            options.agent.agentId,
            parsed.idempotencyKey,
          );
          if (again) return again;

          const quote = await loadTradeQuoteForExecute(options.quoteStore, {
            quoteId: parsed.quoteId,
            agentId: options.agent.agentId,
            ...(options.now ? { now: options.now } : {}),
          });

          assertBalance(quote, options.balance);

          const spendLedger = options.spendLedger ?? new MemorySpendLedger();
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
            if (quote.dollarsIn > options.agent.maxTradeUsd + 1e-9) {
              const body: AgentExecuteErrorBody = {
                ok: false,
                code: "spend_limit_exceeded",
                message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds the per-trade limit of $${options.agent.maxTradeUsd.toFixed(2)}.`,
                quoteId: quote.quoteId,
              };
              await options.idempotencyStore.save(
                options.agent.agentId,
                parsed.idempotencyKey,
                body,
              );
              return body;
            }
            const body: AgentExecuteErrorBody = {
              ok: false,
              code: "spend_limit_exceeded",
              message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds remaining spend budget of $${remaining.toFixed(2)}.`,
              quoteId: quote.quoteId,
            };
            await options.idempotencyStore.save(
              options.agent.agentId,
              parsed.idempotencyKey,
              body,
            );
            return body;
          }

          // ADR 0020: claim before any signing side effect.
          const claimed = await options.quoteStore.markUsed(quote.quoteId);
          if (!claimed) {
            await spendLedger.release(options.agent.agentId, quote.dollarsIn);
            const body: AgentExecuteErrorBody = {
              ok: false,
              code: "quote_mismatch",
              message: "That quote has already been consumed.",
              quoteId: quote.quoteId,
            };
            await options.idempotencyStore.save(
              options.agent.agentId,
              parsed.idempotencyKey,
              body,
            );
            return body;
          }

          const now = options.now?.() ?? new Date();
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
            action: "trade",
            dollarsIn: quote.dollarsIn,
            floorUsd: quote.floorUsd,
            intent: quote.intent,
            sizeUsd: quote.sizeUsd,
            agreedQuote,
            rawTransaction: quote.rawTransaction,
            issuedAt: now.toISOString(),
            expiresAt: new Date(permitExpiry).toISOString(),
            status: "issued",
          };
          await options.permitStore.save(record);

          return {
            ok: true as const,
            permitId,
            quoteId: quote.quoteId,
            quoteFingerprint: quote.quoteFingerprint,
            dollarsIn: quote.dollarsIn,
            floorUsd: quote.floorUsd,
            expiresAt: record.expiresAt,
            intent: quote.intent,
            sizeUsd: quote.sizeUsd,
            agreedQuote,
            rawTransaction: quote.rawTransaction,
            transactionId: quote.transactionId,
            idempotencyKey: parsed.idempotencyKey,
          };
        },
      );
    } catch (error) {
      if (error instanceof AgentExecuteError) {
        const body = error.toBody();
        await options.idempotencyStore.save(
          options.agent.agentId,
          parsed.idempotencyKey,
          body,
        );
        return body;
      }
      if (error instanceof AgentQuoteError) {
        const code = error.code;
        if (
          code === "quote_not_found" ||
          code === "quote_expired" ||
          code === "quote_mismatch"
        ) {
          const body: AgentExecuteErrorBody = {
            ok: false,
            code,
            message: error.message,
            quoteId: parsed.quoteId,
          };
          await options.idempotencyStore.save(
            options.agent.agentId,
            parsed.idempotencyKey,
            body,
          );
          return body;
        }
      }
      const body: AgentExecuteErrorBody = {
        ok: false,
        code: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Could not issue an execution permit.",
        quoteId: parsed.quoteId,
      };
      await options.idempotencyStore.save(
        options.agent.agentId,
        parsed.idempotencyKey,
        body,
      );
      return body;
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
  send: SignedTradeSender;
  spendLedger?: AgentSpendLedger;
  onSpend?: (dollarsIn: number) => void | Promise<void>;
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
  if (!rootHashSignature.startsWith("0x")) {
    return invalidInput(
      "rootHashSignature",
      "required",
      "Provide the local rootHash signature for this permit.",
    ).toBody();
  }

  const idemKey = `${options.agent.agentId}\0${idempotencyKey}`;
  return withLock(permitIdemLocks, idemKey, async () => {
    const prior = await options.idempotencyStore.get(
      options.agent.agentId,
      idempotencyKey,
    );
    if (prior) return prior;

    const persist = async (
      result: AgentExecuteResult,
    ): Promise<AgentExecuteResult> => {
      await options.idempotencyStore.save(
        options.agent.agentId,
        idempotencyKey,
        result,
      );
      return result;
    };

    const permit = await options.permitStore.get(permitId);
    if (!permit || permit.agentId !== options.agent.agentId) {
      return persist({
        ok: false,
        code: "unavailable",
        message: "Execution permit not found.",
      });
    }
    if (permit.idempotencyKey !== idempotencyKey) {
      return persist({
        ok: false,
        code: "quote_mismatch",
        message: "idempotencyKey does not match the issued permit.",
        quoteId: permit.quoteId,
      });
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
      return persist({
        ok: false,
        code: "quote_mismatch",
        message: "That execution permit has already been consumed.",
        quoteId: permit.quoteId,
      });
    }
    if (new Date(permit.expiresAt).getTime() <= now.getTime()) {
      await options.permitStore.casStatus(permitId, "issued", "released");
      await options.spendLedger?.release(
        options.agent.agentId,
        permit.dollarsIn,
      );
      return persist({
        ok: false,
        code: "quote_expired",
        message:
          "The execution permit expired before submission. Call conviction_quote_trade for a new quoteId.",
        quoteId: permit.quoteId,
      });
    }

    // Claim permit before provider side effects so concurrent submits cannot both send.
    const claimed = await options.permitStore.casStatus(
      permitId,
      "issued",
      "consumed",
    );
    if (!claimed) {
      return persist({
        ok: false,
        code: "quote_mismatch",
        message: "That execution permit has already been consumed.",
        quoteId: permit.quoteId,
      });
    }

    const receiptSlug =
      options.randomId?.() ??
      `rcpt_${permit.quoteId.replace(/-/g, "").slice(0, 12)}`;

    let sendResult: Awaited<ReturnType<SignedTradeSender>>;
    try {
      sendResult = await options.send({
        rawTransaction: permit.rawTransaction as RawTransaction,
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
      return persist({
        ok: false,
        code: "unavailable",
        message:
          "Trade submission is uncertain and recorded for reconciliation. Do not resign or submit another transaction.",
        quoteId: permit.quoteId,
      });
    }

    try {
      await options.receipts.save(sendResult.receipt);
      await options.onSpend?.(permit.dollarsIn);
      await options.spendLedger?.commit(
        options.agent.agentId,
        permit.dollarsIn,
      );
    } catch (error) {
      await options.spendLedger?.commit(
        options.agent.agentId,
        permit.dollarsIn,
      );
      return persist({
        ok: false,
        code: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Trade executed but receipt persistence failed.",
        quoteId: permit.quoteId,
      });
    }

    return persist({
      ok: true,
      receiptId: sendResult.receipt.slug,
      quoteId: permit.quoteId,
      quoteFingerprint: permit.quoteFingerprint,
      transactionId: sendResult.transactionId,
      summary: sendResult.summary,
      receipt: sendResult.receipt,
      dollarsIn: permit.dollarsIn,
      dollarsOut: sendResult.receipt.dollarsOut,
      feeUsd: sendResult.receipt.feeUsd,
      idempotencyKey,
    });
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
