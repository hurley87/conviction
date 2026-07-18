// Agent back quote + durable attribution (issue #58 / ADR 0028 / 0029 / 0031).
// Target is always derived from the canonical conviction — never caller TokenRef.

import { randomUUID } from "node:crypto";

import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  AgentQuoteError,
  buildQuoteFingerprint,
  computeQuoteExpiresAt,
  hashFingerprint,
  type AgentQuoteStore,
  type AgentTradeQuoteRecord,
  type AgentTradeQuoteResponse,
  type QuoteFieldError,
} from "@/lib/agent-quote";
import type {
  AgentExecuteErrorBody,
  AgentExecuteSuccess,
  AgentIdempotencyStore,
} from "@/lib/agent-execute";
import {
  COPY_TRADE_CAP_USD,
  copyIntent,
  copyTradeSizeUsd,
} from "@/lib/verbs/copy";
import { validateIntent } from "@/lib/verbs/intent";
import type { WarmUpRouteResult, WarmUpToken } from "@/lib/ua/warm-up";
import type { UAClient } from "@/lib/ua/types";
import type {
  AuthorshipSnapshot,
  ConvictionEntry,
  DestChain,
  ProductAsset,
  Receipt,
  TradeIntent,
  TradeQuote,
  UniversalBalance,
} from "@/lib/verbs/types";

export type ReconciliationState =
  | "complete"
  | "pending_sync"
  | "needs_attention";

export type AgentBackAuthorship = AuthorshipSnapshot;

export type AgentBackRecord = {
  backRecordId: string;
  agentId: string;
  entryId: string;
  receiptId: string;
  quoteId: string;
  quoteFingerprint: string;
  idempotencyKey: string;
  authorship: AgentBackAuthorship;
  reconciliationState: ReconciliationState;
  /** Failed attribution attempts recorded on the durable row (ADR 0029). */
  attemptCount: number;
  workflowRunId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

/** Max attribution attempts before escalating to needs_attention. */
export const MAX_BACK_ATTRIBUTION_ATTEMPTS = 5;

export type AgentBackQuoteResponse = Omit<AgentTradeQuoteResponse, "action"> & {
  action: "back";
  entryId: string;
  targetFingerprint: string;
};

export type AgentBackSuccess = AgentExecuteSuccess & {
  action: "back";
  entryId: string;
  backRecordId: string;
  reconciliationState: ReconciliationState;
  authorship: AgentBackAuthorship;
  /** Present when onchain succeeded but social attribution is still syncing. */
  code?: "executed_pending_sync";
};

export type AgentBackErrorCode =
  | AgentExecuteErrorBody["code"]
  | "conviction_not_found"
  | "target_unroutable"
  | "executed_pending_sync";

export type AgentBackErrorBody = Omit<AgentExecuteErrorBody, "code" | "action"> & {
  code: Exclude<AgentBackErrorCode, "executed_pending_sync">;
  action?: "back";
  entryId?: string;
  backRecordId?: string;
};

export type AgentBackResult = AgentBackSuccess | AgentBackErrorBody;

export type AgentBackRecordStore = {
  save(record: AgentBackRecord): Promise<AgentBackRecord>;
  get(backRecordId: string): Promise<AgentBackRecord | null>;
  getByReceiptId(receiptId: string): Promise<AgentBackRecord | null>;
  getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentBackRecord | null>;
  /**
   * CAS reconciliation state. Returns the updated record when this caller wins,
   * or null when the expected `from` state no longer matches.
   */
  casReconciliationState(input: {
    backRecordId: string;
    from: ReconciliationState;
    to: ReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentBackRecord | null>;
  setWorkflowRunId(
    backRecordId: string,
    workflowRunId: string,
  ): Promise<void>;
};

/** In-memory back-record store for tests and offline mock paths. */
export class MemoryAgentBackRecordStore implements AgentBackRecordStore {
  private readonly records = new Map<string, AgentBackRecord>();
  private readonly byReceipt = new Map<string, string>();
  private readonly byIdempotency = new Map<string, string>();

  private idemKey(agentId: string, idempotencyKey: string): string {
    return `${agentId}\0${idempotencyKey}`;
  }

  async save(record: AgentBackRecord): Promise<AgentBackRecord> {
    const existingByReceipt = this.byReceipt.get(record.receiptId);
    if (existingByReceipt) {
      const existing = this.records.get(existingByReceipt);
      if (existing) return structuredClone(existing);
    }
    const existingByIdem = this.byIdempotency.get(
      this.idemKey(record.agentId, record.idempotencyKey),
    );
    if (existingByIdem) {
      const existing = this.records.get(existingByIdem);
      if (existing) return structuredClone(existing);
    }
    const frozen = structuredClone(record);
    this.records.set(record.backRecordId, frozen);
    this.byReceipt.set(record.receiptId, record.backRecordId);
    this.byIdempotency.set(
      this.idemKey(record.agentId, record.idempotencyKey),
      record.backRecordId,
    );
    return structuredClone(frozen);
  }

  async get(backRecordId: string): Promise<AgentBackRecord | null> {
    const stored = this.records.get(backRecordId);
    return stored ? structuredClone(stored) : null;
  }

  async getByReceiptId(receiptId: string): Promise<AgentBackRecord | null> {
    const id = this.byReceipt.get(receiptId);
    if (!id) return null;
    return this.get(id);
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentBackRecord | null> {
    const id = this.byIdempotency.get(this.idemKey(agentId, idempotencyKey));
    if (!id) return null;
    return this.get(id);
  }

  async casReconciliationState(input: {
    backRecordId: string;
    from: ReconciliationState;
    to: ReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentBackRecord | null> {
    const stored = this.records.get(input.backRecordId);
    if (!stored || stored.reconciliationState !== input.from) return null;
    const next: AgentBackRecord = {
      ...stored,
      reconciliationState: input.to,
      updatedAt: new Date().toISOString(),
      ...(input.workflowRunId !== undefined
        ? { workflowRunId: input.workflowRunId }
        : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.completedAt !== undefined
        ? { completedAt: input.completedAt }
        : {}),
      ...(input.attemptCount !== undefined
        ? { attemptCount: input.attemptCount }
        : {}),
    };
    this.records.set(input.backRecordId, next);
    return structuredClone(next);
  }

  async setWorkflowRunId(
    backRecordId: string,
    workflowRunId: string,
  ): Promise<void> {
    const stored = this.records.get(backRecordId);
    if (!stored) return;
    stored.workflowRunId = workflowRunId;
    stored.updatedAt = new Date().toISOString();
  }

  clear(): void {
    this.records.clear();
    this.byReceipt.clear();
    this.byIdempotency.clear();
  }
}

export type ConvictionLoader = {
  get(entryId: string): Promise<ConvictionEntry | null>;
};

export type BackAttributionApplier = {
  /**
   * Idempotently attribute a successful back onto the public conviction.
   * Must preserve authorship snapshot and agent disclosure.
   */
  apply(input: {
    entryId: string;
    authorship: AgentBackAuthorship;
  }): Promise<{ ok: true } | { ok: false; retryable: boolean; message: string }>;
};

export type BackWorkflowStarter = {
  start(backRecordId: string): Promise<{ runId: string }>;
};

const BACK_QUOTE_ALLOWED_KEYS = new Set(["entryId", "dollarsIn", "fraction"]);

export function deriveBackAuthorship(agent: OwnedAgent): AgentBackAuthorship {
  return {
    agentId: agent.agentId,
    authorKind: "agent",
    handle: agent.handle,
    operatorHandle: agent.operatorHandle,
  };
}

export function buildBackTargetFingerprint(input: {
  entryId: string;
  intent: TradeIntent;
}): string {
  return hashFingerprint({
    entryId: input.entryId,
    toAsset: input.intent.toAsset,
    destChain: input.intent.destChain ?? null,
    token: input.intent.token
      ? {
          chainId: input.intent.token.chainId,
          address: input.intent.token.address.toLowerCase(),
          symbol: input.intent.token.symbol,
        }
      : null,
    fromAsset: input.intent.fromAsset ?? null,
  });
}

function assertQuoteEligibleLifecycle(agent: OwnedAgent): void {
  if (
    agent.status === "retired" ||
    agent.status === "retiring" ||
    agent.status === "provisioning"
  ) {
    throw new AgentQuoteError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and cannot request back quotes.`,
    );
  }
}

/**
 * Parse quote_back inputs. Rejects arbitrary token / destination overrides
 * (ADR 0031) — only entryId + size.
 */
export function parseBackQuoteInput(body: Record<string, unknown>): {
  entryId: string;
  dollarsIn?: number;
  fraction?: number;
} {
  const unknownKeys = Object.keys(body).filter(
    (key) => !BACK_QUOTE_ALLOWED_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    const looksLikeToken = unknownKeys.some((key) =>
      /token|address|contract|chainId|toAsset|destChain/i.test(key),
    );
    throw new AgentQuoteError(
      looksLikeToken ? "arbitrary_token_rejected" : "invalid_input",
      looksLikeToken
        ? "Back quotes derive the target from the canonical conviction. Token addresses and destination overrides are rejected."
        : "Back quote fields include unsupported keys.",
      {
        fields: unknownKeys.map((field) => ({
          field,
          code: looksLikeToken ? "forbidden_field" : "unknown_field",
          message: looksLikeToken
            ? `Remove "${field}". The approved target comes from the published conviction.`
            : `Unknown field "${field}". Supported: entryId, dollarsIn, fraction.`,
        })),
      },
    );
  }

  const fields: QuoteFieldError[] = [];
  const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
  if (!entryId) {
    fields.push({
      field: "entryId",
      code: "required",
      message: "Provide the entryId of the canonical conviction to back.",
    });
  }

  const hasDollars = body.dollarsIn !== undefined && body.dollarsIn !== null;
  const hasFraction = body.fraction !== undefined && body.fraction !== null;
  if (hasDollars === hasFraction) {
    fields.push({
      field: hasDollars ? "dollarsIn" : "dollarsIn|fraction",
      code: "size_required",
      message:
        "Provide exactly one of dollarsIn (positive dollars) or fraction (0–1 of balance).",
    });
  }

  let dollarsIn: number | undefined;
  if (hasDollars) {
    if (typeof body.dollarsIn !== "number" || !Number.isFinite(body.dollarsIn)) {
      fields.push({
        field: "dollarsIn",
        code: "invalid_type",
        message: "dollarsIn must be a finite positive number.",
      });
    } else if (body.dollarsIn <= 0) {
      fields.push({
        field: "dollarsIn",
        code: "invalid_value",
        message: "dollarsIn must be greater than zero.",
      });
    } else {
      dollarsIn = body.dollarsIn;
    }
  }

  let fraction: number | undefined;
  if (hasFraction) {
    if (typeof body.fraction !== "number" || !Number.isFinite(body.fraction)) {
      fields.push({
        field: "fraction",
        code: "invalid_type",
        message: "fraction must be a finite number between 0 and 1.",
      });
    } else if (body.fraction <= 0 || body.fraction > 1) {
      fields.push({
        field: "fraction",
        code: "invalid_value",
        message: "fraction must be greater than 0 and at most 1.",
      });
    } else {
      fraction = body.fraction;
    }
  }

  if (fields.length > 0) {
    throw new AgentQuoteError(
      "invalid_input",
      "Back quote fields failed validation. Fix the listed fields and retry.",
      { fields },
    );
  }

  return {
    entryId,
    ...(dollarsIn != null ? { dollarsIn } : {}),
    ...(fraction != null ? { fraction } : {}),
  };
}

async function revalidateBackTarget(input: {
  intent: TradeIntent;
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
}): Promise<void> {
  if (!input.intent.token) return;
  const result = await input.checkRouter({
    chainId: input.intent.token.chainId,
    address: input.intent.token.address,
  });
  if (result.status !== "routable") {
    throw new AgentQuoteError(
      "unsupported_asset",
      "The conviction's token target is not currently routable through Universal Account.",
      {
        fields: [
          {
            field: "entryId",
            code: "target_unroutable",
            message:
              "Revalidation failed for the canonical conviction target. Try again later or pick another conviction.",
          },
        ],
      },
    );
  }
}

function toBackQuoteResponse(
  record: AgentTradeQuoteRecord,
  serverTime: string,
): AgentBackQuoteResponse {
  if (record.action !== "back" || !record.entryId || !record.targetFingerprint) {
    throw new Error("Expected a persisted back quote record.");
  }
  return {
    ok: true,
    quoteId: record.quoteId,
    action: "back",
    quoteFingerprint: record.quoteFingerprint,
    issuedAt: record.issuedAt,
    serverTime,
    expiresAt: record.expiresAt,
    dollarsIn: record.dollarsIn,
    dollarsOut: record.dollarsOut,
    feeUsd: record.feeUsd,
    floorUsd: record.floorUsd,
    sourceChain: record.sourceChain,
    destChain: record.destChain,
    toAsset: record.toAsset,
    ...(record.receivedSymbol ? { receivedSymbol: record.receivedSymbol } : {}),
    sizeUsd: record.sizeUsd,
    publicationIntent: false,
    entryId: record.entryId,
    targetFingerprint: record.targetFingerprint,
  };
}

/**
 * Issue a research-only back quote derived from a canonical conviction.
 * Moves no funds and reserves no spend (available when back is disabled).
 */
export async function issueBackQuote(options: {
  store: AgentQuoteStore;
  ua: UAClient;
  agent: OwnedAgent;
  body: Record<string, unknown>;
  convictions: ConvictionLoader;
  now?: () => Date;
  randomId?: () => string;
  providerExpiresAt?: Date | null;
  checkRouter?: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  balance?: UniversalBalance;
}): Promise<AgentBackQuoteResponse> {
  assertQuoteEligibleLifecycle(options.agent);

  const parsed = parseBackQuoteInput(options.body);
  const entry = await options.convictions.get(parsed.entryId);
  if (!entry) {
    throw new AgentQuoteError(
      "invalid_input",
      "No canonical conviction matches that entryId.",
      {
        fields: [
          {
            field: "entryId",
            code: "conviction_not_found",
            message: "Provide an entryId from conviction_list_convictions or conviction_get_conviction.",
          },
        ],
      },
    );
  }

  const balance =
    options.balance ?? (await options.ua.getUniversalBalance());

  let sizeUsd: number;
  if (parsed.dollarsIn != null) {
    // Research quotes remain available while unfunded (ADR 0039) — cap by the
    // product copy ceiling, not by a zero balance.
    const cap =
      balance.totalUsd > 0
        ? Math.min(balance.totalUsd, COPY_TRADE_CAP_USD)
        : COPY_TRADE_CAP_USD;
    sizeUsd = Math.min(Math.max(0, parsed.dollarsIn), cap);
    if (sizeUsd <= 0) {
      throw new AgentQuoteError(
        "invalid_input",
        "dollarsIn resolved to zero against the current size cap.",
        {
          fields: [
            {
              field: "dollarsIn",
              code: "resolved_zero",
              message: "Choose a positive dollarsIn within the copy size cap.",
            },
          ],
        },
      );
    }
  } else if (parsed.fraction != null) {
    if (balance.totalUsd <= 0) {
      throw new AgentQuoteError(
        "invalid_input",
        "fraction requires a spendable balance. Pass dollarsIn while the account is unfunded.",
        {
          fields: [
            {
              field: "fraction",
              code: "requires_balance",
              message: "Use dollarsIn for research quotes on an unfunded account.",
            },
          ],
        },
      );
    }
    sizeUsd = copyTradeSizeUsd(balance, balance.totalUsd * parsed.fraction);
  } else {
    throw new AgentQuoteError(
      "invalid_input",
      "Provide exactly one of dollarsIn or fraction.",
    );
  }

  const intent = copyIntent(entry.trade);
  // Research validation: when unfunded, skip balance sufficiency so quoting still works.
  const researchBalance: UniversalBalance =
    balance.totalUsd > 0
      ? balance
      : {
          totalUsd: sizeUsd,
          sources: [
            {
              chain: intent.destChain ?? "Arbitrum",
              asset: "USDC",
              usd: sizeUsd,
            },
          ],
        };
  const validation = validateIntent({ ...intent, sizeUsd }, researchBalance);
  if (!validation.ok) {
    throw new AgentQuoteError("invalid_input", validation.error, {
      fields: [
        {
          field: "entryId",
          code: "intent_invalid",
          message: validation.error,
        },
      ],
    });
  }

  const checkRouter =
    options.checkRouter ??
    (async (): Promise<WarmUpRouteResult> => ({ status: "routable" }));
  await revalidateBackTarget({
    intent: validation.intent,
    checkRouter,
  });

  const tradeQuote: TradeQuote = await options.ua.quoteTrade({
    intent: validation.intent,
    sizeUsd: validation.sizeUsd,
  });

  const now = options.now?.() ?? new Date();
  const issuedAt = now.toISOString();
  const providerExpiresAt = options.providerExpiresAt ?? null;
  const expiresAt = computeQuoteExpiresAt({
    issuedAt: now,
    providerExpiresAt,
  }).toISOString();

  const targetFingerprint = buildBackTargetFingerprint({
    entryId: entry.entryId,
    intent: validation.intent,
  });

  const quoteFingerprint = buildQuoteFingerprint({
    action: "back",
    intent: validation.intent,
    sizeUsd: validation.sizeUsd,
    publicationIntent: false,
    dollarsIn: tradeQuote.dollarsIn,
    dollarsOut: tradeQuote.dollarsOut,
    feeUsd: tradeQuote.feeUsd,
    floorUsd: tradeQuote.floorUsd,
    sourceChain: tradeQuote.sourceChain,
    destChain: tradeQuote.destChain,
    entryId: entry.entryId,
    targetFingerprint,
  });

  const record: AgentTradeQuoteRecord = {
    quoteId: options.randomId?.() ?? randomUUID(),
    agentId: options.agent.agentId,
    action: "back",
    quoteFingerprint,
    intent: validation.intent,
    sizeUsd: validation.sizeUsd,
    publicationIntent: false,
    dollarsIn: tradeQuote.dollarsIn,
    dollarsOut: tradeQuote.dollarsOut,
    feeUsd: tradeQuote.feeUsd,
    floorUsd: tradeQuote.floorUsd,
    sourceChain: tradeQuote.sourceChain,
    destChain: tradeQuote.destChain,
    toAsset: tradeQuote.toAsset,
    ...(tradeQuote.receivedSymbol
      ? { receivedSymbol: tradeQuote.receivedSymbol }
      : {}),
    transactionId: tradeQuote.transactionId,
    rawTransaction: tradeQuote.rawTransaction,
    providerExpiresAt: providerExpiresAt?.toISOString() ?? null,
    issuedAt,
    expiresAt,
    used: false,
    entryId: entry.entryId,
    targetFingerprint,
  };

  await options.store.save(record);
  return toBackQuoteResponse(record, issuedAt);
}

/** Load a stored back quote for execute by quoteId. */
export async function loadBackQuoteForExecute(
  store: AgentQuoteStore,
  input: {
    quoteId: string;
    agentId: string;
    now?: () => Date;
  },
): Promise<AgentTradeQuoteRecord> {
  const record = await store.get(input.quoteId);
  if (!record || record.agentId !== input.agentId) {
    throw new AgentQuoteError(
      "quote_not_found",
      "No back quote matches that quoteId for this agent.",
    );
  }
  if (record.action !== "back") {
    throw new AgentQuoteError(
      "quote_mismatch",
      "That quoteId is not a back quote. Call conviction_quote_back first.",
    );
  }
  if (!record.entryId || !record.targetFingerprint) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "Back quote is missing its bound conviction target.",
    );
  }

  const now = input.now?.() ?? new Date();
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    throw new AgentQuoteError(
      "quote_expired",
      `Quote ${record.quoteId} expired at ${record.expiresAt}. Call conviction_quote_back again for a fresh quoteId.`,
    );
  }
  if (record.used) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "That quote has already been consumed.",
    );
  }

  // Re-derive fingerprint from stored terms so execute cannot swap changed terms.
  const expected = buildQuoteFingerprint({
    action: "back",
    intent: record.intent,
    sizeUsd: record.sizeUsd,
    publicationIntent: false,
    dollarsIn: record.dollarsIn,
    dollarsOut: record.dollarsOut,
    feeUsd: record.feeUsd,
    floorUsd: record.floorUsd,
    sourceChain: record.sourceChain,
    destChain: record.destChain,
    entryId: record.entryId,
    targetFingerprint: record.targetFingerprint,
  });
  if (expected !== record.quoteFingerprint) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "The quote fingerprint does not match the stored terms. Request a new quote.",
    );
  }

  return record;
}

export function buildAgentBackRecord(input: {
  agent: OwnedAgent;
  entryId: string;
  receipt: Receipt;
  quoteId: string;
  quoteFingerprint: string;
  idempotencyKey: string;
  now?: Date;
  randomId?: () => string;
}): AgentBackRecord {
  const now = (input.now ?? new Date()).toISOString();
  return {
    backRecordId: input.randomId?.() ?? randomUUID(),
    agentId: input.agent.agentId,
    entryId: input.entryId,
    receiptId: input.receipt.slug,
    quoteId: input.quoteId,
    quoteFingerprint: input.quoteFingerprint,
    idempotencyKey: input.idempotencyKey,
    authorship: deriveBackAuthorship(input.agent),
    reconciliationState: "pending_sync",
    attemptCount: 0,
    workflowRunId: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

export function toBackSuccessFromRecord(input: {
  execute: AgentExecuteSuccess;
  record: AgentBackRecord;
}): AgentBackSuccess {
  const pending = input.record.reconciliationState !== "complete";
  return {
    ...input.execute,
    action: "back",
    entryId: input.record.entryId,
    backRecordId: input.record.backRecordId,
    reconciliationState: input.record.reconciliationState,
    authorship: input.record.authorship,
    ...(pending ? { code: "executed_pending_sync" as const } : {}),
  };
}

/**
 * Atomically persist receipt + one back record, then start attribution.
 * Never re-executes onchain work (ADR 0028 / 0029).
 */
export async function commitBackExecution(options: {
  agent: OwnedAgent;
  execute: AgentExecuteSuccess;
  entryId: string;
  backStore: AgentBackRecordStore;
  idempotencyStore: AgentIdempotencyStore;
  startWorkflow: BackWorkflowStarter;
  attributeNow?: BackAttributionApplier;
  now?: () => Date;
  randomId?: () => string;
}): Promise<AgentBackSuccess> {
  const existing = await options.backStore.getByReceiptId(
    options.execute.receiptId,
  );
  if (existing) {
    const success = toBackSuccessFromRecord({
      execute: options.execute,
      record: existing,
    });
    await options.idempotencyStore.save(
      options.agent.agentId,
      options.execute.idempotencyKey,
      success,
    );
    return success;
  }

  const byIdem = await options.backStore.getByIdempotency(
    options.agent.agentId,
    options.execute.idempotencyKey,
  );
  if (byIdem) {
    const success = toBackSuccessFromRecord({
      execute: options.execute,
      record: byIdem,
    });
    await options.idempotencyStore.save(
      options.agent.agentId,
      options.execute.idempotencyKey,
      success,
    );
    return success;
  }

  const record = buildAgentBackRecord({
    agent: options.agent,
    entryId: options.entryId,
    receipt: options.execute.receipt,
    quoteId: options.execute.quoteId,
    quoteFingerprint: options.execute.quoteFingerprint,
    idempotencyKey: options.execute.idempotencyKey,
    ...(options.now ? { now: options.now() } : {}),
    ...(options.randomId ? { randomId: options.randomId } : {}),
  });

  // Durable commit before any social attribution attempt (ADR 0028).
  const saved = await options.backStore.save(record);
  if (saved.backRecordId !== record.backRecordId) {
    // Concurrent winner already persisted this receipt / idempotency key.
    const success = toBackSuccessFromRecord({
      execute: options.execute,
      record: saved,
    });
    await options.idempotencyStore.save(
      options.agent.agentId,
      options.execute.idempotencyKey,
      success,
    );
    return success;
  }

  let working = saved;

  // Optional synchronous first attempt — failures stay pending_sync.
  if (options.attributeNow) {
    const attributed = await options.attributeNow.apply({
      entryId: record.entryId,
      authorship: record.authorship,
    });
    if (attributed.ok) {
      const completed = await options.backStore.casReconciliationState({
        backRecordId: record.backRecordId,
        from: "pending_sync",
        to: "complete",
        lastError: null,
        completedAt: (options.now?.() ?? new Date()).toISOString(),
      });
      if (completed) working = completed;
    } else {
      await options.backStore.casReconciliationState({
        backRecordId: record.backRecordId,
        from: "pending_sync",
        to: "pending_sync",
        lastError: attributed.message,
      });
    }
  }

  if (working.reconciliationState !== "complete") {
    try {
      const started = await options.startWorkflow.start(working.backRecordId);
      await options.backStore.setWorkflowRunId(
        working.backRecordId,
        started.runId,
      );
      working = {
        ...working,
        workflowRunId: started.runId,
      };
    } catch (error) {
      // Workflow start failure must not undo onchain success or the back record.
      await options.backStore.casReconciliationState({
        backRecordId: working.backRecordId,
        from: "pending_sync",
        to: "pending_sync",
        lastError:
          error instanceof Error
            ? error.message
            : "Could not start attribution workflow.",
      });
    }
  }

  const latest =
    (await options.backStore.get(working.backRecordId)) ?? working;
  const success = toBackSuccessFromRecord({
    execute: options.execute,
    record: latest,
  });
  await options.idempotencyStore.save(
    options.agent.agentId,
    options.execute.idempotencyKey,
    success,
  );
  return success;
}

/**
 * Idempotent attribution step used by Vercel Workflow and local/test runners.
 * Never signs, never issues permits, never moves funds (ADR 0029).
 * Each failed attempt increments durable `attemptCount` until maxAttempts.
 */
export async function reconcileBackAttribution(options: {
  backRecordId: string;
  backStore: AgentBackRecordStore;
  attribute: BackAttributionApplier;
  now?: () => Date;
  /** After this many recorded failures, escalate to needs_attention. */
  maxAttempts?: number;
}): Promise<AgentBackRecord> {
  const record = await options.backStore.get(options.backRecordId);
  if (!record) {
    throw new Error(`Back record ${options.backRecordId} not found.`);
  }
  if (
    record.reconciliationState === "complete" ||
    record.reconciliationState === "needs_attention"
  ) {
    return record;
  }

  const attributed = await options.attribute.apply({
    entryId: record.entryId,
    authorship: record.authorship,
  });

  if (attributed.ok) {
    const completed = await options.backStore.casReconciliationState({
      backRecordId: record.backRecordId,
      from: record.reconciliationState,
      to: "complete",
      lastError: null,
      completedAt: (options.now?.() ?? new Date()).toISOString(),
    });
    return completed ?? ((await options.backStore.get(record.backRecordId)) as AgentBackRecord);
  }

  const attempts = (record.attemptCount ?? 0) + 1;
  const maxAttempts = options.maxAttempts ?? MAX_BACK_ATTRIBUTION_ATTEMPTS;
  const nextState: ReconciliationState =
    !attributed.retryable || attempts >= maxAttempts
      ? "needs_attention"
      : "pending_sync";

  const updated = await options.backStore.casReconciliationState({
    backRecordId: record.backRecordId,
    from: record.reconciliationState,
    to: nextState,
    lastError: attributed.message,
    attemptCount: attempts,
  });
  return updated ?? ((await options.backStore.get(record.backRecordId)) as AgentBackRecord);
}

/**
 * Retry attribution until complete, needs_attention, or maxAttempts.
 * Used by the local/test workflow world (no Vercel Workflow runtime).
 */
export async function runBackAttributionRetries(options: {
  backRecordId: string;
  backStore: AgentBackRecordStore;
  attribute: BackAttributionApplier;
  maxAttempts?: number;
  delayMs?: number;
  now?: () => Date;
}): Promise<AgentBackRecord> {
  const maxAttempts = options.maxAttempts ?? MAX_BACK_ATTRIBUTION_ATTEMPTS;
  let latest = await reconcileBackAttribution({
    backRecordId: options.backRecordId,
    backStore: options.backStore,
    attribute: options.attribute,
    maxAttempts,
    ...(options.now ? { now: options.now } : {}),
  });

  for (
    let i = 1;
    i < maxAttempts && latest.reconciliationState === "pending_sync";
    i += 1
  ) {
    if ((options.delayMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    latest = await reconcileBackAttribution({
      backRecordId: options.backRecordId,
      backStore: options.backStore,
      attribute: options.attribute,
      maxAttempts,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  return latest;
}

export function backErrorStatus(
  code: Exclude<AgentBackErrorCode, "executed_pending_sync">,
): number {
  switch (code) {
    case "quote_not_found":
    case "conviction_not_found":
      return 404;
    case "lifecycle_blocked":
    case "action_disabled":
    case "quote_expired":
    case "quote_mismatch":
    case "price_floor_breached":
    case "insufficient_balance":
    case "spend_limit_exceeded":
    case "target_unroutable":
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

/** Type helper — narrow execute success that already carries back fields. */
export function isAgentBackSuccess(
  result: AgentExecuteSuccess | AgentBackSuccess,
): result is AgentBackSuccess {
  return (
    "action" in result &&
    result.action === "back" &&
    typeof result.backRecordId === "string"
  );
}

export type { DestChain, ProductAsset };
