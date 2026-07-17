// Publish an agent conviction from a unique owned trade receipt (issue #57).
// ADR 0027 / 0032 / 0033 / 0048 — server-derived authorship, trade, and gate.

import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  isPublicationGateWindowOpen,
  type AgentTradeReceiptRecord,
  type AgentTradeReceiptStore,
} from "@/lib/agent-trade-receipt";
import { runPublicationGateForProduct } from "@/lib/agent-quote";
import { failedCheckName } from "@/lib/gate";
import {
  buildConviction,
  generateConvictionEntryId,
  tradeToConvictionTrade,
} from "@/lib/verbs/conviction";
import type {
  ConvictionEntry,
  GateCheck,
  TradeQuote,
  WhyNowEvent,
} from "@/lib/verbs/types";
import type { WarmUpRouteResult, WarmUpToken } from "@/lib/ua/warm-up";

const ALLOWED_INPUT_KEYS = new Set([
  "receiptId",
  "thesis",
  "whyNow",
  "whatBreaksIt",
]);

const FORBIDDEN_OVERRIDE_KEYS = new Set([
  "handle",
  "authorKind",
  "operatorHandle",
  "agentId",
  "trade",
  "gateReport",
  "gateVersion",
  "targetFingerprint",
  "receiptSlug",
  "entryId",
  "createdAt",
  "backedBy",
  "authorship",
]);

export type AgentAuthorshipSnapshot = {
  agentId: string;
  authorKind: "agent";
  handle: string;
  operatorHandle: string;
};

export type AgentPublishInput = {
  receiptId: string;
  thesis: string;
  whyNow: WhyNowEvent[];
  whatBreaksIt: string;
};

export type AgentPublishSuccess = {
  ok: true;
  entryId: string;
  receiptId: string;
  entry: ConvictionEntry;
};

export type AgentPublishErrorCode =
  | "invalid_input"
  | "lifecycle_blocked"
  | "action_disabled"
  | "receipt_not_found"
  | "receipt_not_publishable"
  | "gate_failed"
  | "unavailable";

export type AgentPublishFieldError = {
  field: string;
  code: string;
  message: string;
};

export type AgentPublishErrorBody = {
  ok: false;
  code: AgentPublishErrorCode;
  message: string;
  action?: "publish";
  receiptId?: string;
  fields?: AgentPublishFieldError[];
  gateReport?: GateCheck[];
};

export type AgentPublishResult = AgentPublishSuccess | AgentPublishErrorBody;

export type AgentConvictionPersist = {
  save(entry: ConvictionEntry): Promise<void>;
  get(entryId: string): Promise<ConvictionEntry | null>;
  getByReceiptSlug?(receiptSlug: string): Promise<ConvictionEntry | null>;
};

export class AgentPublishError extends Error {
  constructor(
    public readonly code: AgentPublishErrorCode,
    message: string,
    public readonly details: {
      action?: "publish";
      receiptId?: string;
      fields?: AgentPublishFieldError[];
      gateReport?: GateCheck[];
    } = {},
  ) {
    super(message);
    this.name = "AgentPublishError";
  }

  toBody(): AgentPublishErrorBody {
    return {
      ok: false,
      code: this.code,
      message: this.message,
      ...(this.details.action ? { action: this.details.action } : {}),
      ...(this.details.receiptId ? { receiptId: this.details.receiptId } : {}),
      ...(this.details.fields ? { fields: this.details.fields } : {}),
      ...(this.details.gateReport
        ? { gateReport: this.details.gateReport }
        : {}),
    };
  }
}

export function publishErrorStatus(code: AgentPublishErrorCode): number {
  switch (code) {
    case "receipt_not_found":
      return 404;
    case "lifecycle_blocked":
    case "action_disabled":
    case "receipt_not_publishable":
    case "gate_failed":
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

function assertPublishLifecycle(agent: OwnedAgent): void {
  if (agent.status === "active") return;
  throw new AgentPublishError(
    "lifecycle_blocked",
    `Agent @${agent.handle} is ${agent.status} and cannot publish convictions.`,
  );
}

function assertPublishEnabled(agent: OwnedAgent): void {
  if (agent.actionPolicy.publish) return;
  throw new AgentPublishError(
    "action_disabled",
    "Publish is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
    { action: "publish" },
  );
}

function parseWhyNowEvents(
  value: unknown,
  publishedAt: string,
): WhyNowEvent[] | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return [{ at: publishedAt, event: trimmed }];
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const events: WhyNowEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (typeof row.at !== "string" || !row.at.trim()) return null;
    if (typeof row.event !== "string" || !row.event.trim()) return null;
    events.push({ at: row.at.trim(), event: row.event.trim() });
  }
  return events;
}

/**
 * Parse publish tool/API body. Rejects authorship, trade, and gate overrides.
 */
export function parseAgentPublishInput(
  body: Record<string, unknown>,
  options?: { publishedAt?: string },
): AgentPublishInput {
  const unknownKeys = Object.keys(body).filter(
    (key) => !ALLOWED_INPUT_KEYS.has(key),
  );
  if (unknownKeys.length > 0) {
    const override = unknownKeys.find((key) => FORBIDDEN_OVERRIDE_KEYS.has(key));
    if (override) {
      throw new AgentPublishError(
        "invalid_input",
        `Publish inputs cannot set or override "${override}". Identity, trade metadata, and gate outcomes are server-derived.`,
        {
          fields: unknownKeys.map((field) => ({
            field,
            code: FORBIDDEN_OVERRIDE_KEYS.has(field)
              ? "forbidden_field"
              : "unknown_field",
            message: FORBIDDEN_OVERRIDE_KEYS.has(field)
              ? `Remove "${field}". It is derived by Conviction and cannot be supplied.`
              : `Unknown field "${field}". Supported: receiptId, thesis, whyNow, whatBreaksIt.`,
          })),
        },
      );
    }
    throw new AgentPublishError(
      "invalid_input",
      "Publish fields include unsupported keys.",
      {
        fields: unknownKeys.map((field) => ({
          field,
          code: "unknown_field",
          message: `Unknown field "${field}". Supported: receiptId, thesis, whyNow, whatBreaksIt.`,
        })),
      },
    );
  }

  const fields: AgentPublishFieldError[] = [];
  const receiptId =
    typeof body.receiptId === "string" ? body.receiptId.trim() : "";
  if (!receiptId) {
    fields.push({
      field: "receiptId",
      code: "required",
      message: "Provide the receiptId from a successful agent-owned trade.",
    });
  }

  const thesis = typeof body.thesis === "string" ? body.thesis.trim() : "";
  if (!thesis) {
    fields.push({
      field: "thesis",
      code: "required",
      message: "Provide a thesis for the conviction.",
    });
  }

  const publishedAt = options?.publishedAt ?? new Date().toISOString();
  const whyNow = parseWhyNowEvents(body.whyNow, publishedAt);
  if (!whyNow) {
    fields.push({
      field: "whyNow",
      code: "required",
      message:
        'Provide whyNow as a non-empty string or an array of { at, event } items.',
    });
  }

  const whatBreaksIt =
    typeof body.whatBreaksIt === "string" ? body.whatBreaksIt.trim() : "";
  if (!whatBreaksIt) {
    fields.push({
      field: "whatBreaksIt",
      code: "required",
      message: "Provide whatBreaksIt as a non-empty falsifier string.",
    });
  }

  if (fields.length > 0) {
    throw new AgentPublishError(
      "invalid_input",
      "Publish input is incomplete or invalid.",
      { fields },
    );
  }

  return {
    receiptId,
    thesis,
    whyNow: whyNow!,
    whatBreaksIt,
  };
}

function authorshipSnapshot(agent: OwnedAgent): AgentAuthorshipSnapshot {
  return {
    agentId: agent.agentId,
    authorKind: "agent",
    handle: agent.handle,
    operatorHandle: agent.operatorHandle,
  };
}

function tradeQuoteFromReceipt(record: AgentTradeReceiptRecord): TradeQuote {
  return {
    dollarsIn: record.dollarsIn,
    dollarsOut: record.dollarsOut,
    feeUsd: record.feeUsd,
    etaSeconds: 45,
    floorUsd: record.dollarsOut,
    sourceChain: record.sourceChain,
    destChain: record.destChain,
    toAsset: record.toAsset,
    ...(record.receivedSymbol ? { receivedSymbol: record.receivedSymbol } : {}),
    transactionId: record.quoteId,
    rawTransaction: null,
  };
}

function assertReceiptPublishable(
  record: AgentTradeReceiptRecord | null,
  agentId: string,
  receiptId: string,
): AgentTradeReceiptRecord {
  if (!record) {
    throw new AgentPublishError(
      "receipt_not_found",
      "No successful agent trade receipt matches that receiptId.",
      { receiptId },
    );
  }
  if (record.agentId !== agentId) {
    throw new AgentPublishError(
      "receipt_not_publishable",
      "That receipt belongs to a different agent and cannot be published here.",
      { receiptId },
    );
  }
  if (record.kind !== "trade" || record.status !== "success") {
    throw new AgentPublishError(
      "receipt_not_publishable",
      "Only successful agent-owned trade receipts can be published.",
      { receiptId },
    );
  }
  if (!record.publishable) {
    // Caller should have returned the existing conviction via idempotency first.
    throw new AgentPublishError(
      "receipt_not_publishable",
      "That receipt has already been published.",
      { receiptId },
    );
  }
  return record;
}

async function resolveGateReport(options: {
  record: AgentTradeReceiptRecord;
  now: Date;
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  fetchImpl?: typeof fetch;
}): Promise<GateCheck[]> {
  const { record, now } = options;
  const canReuseBoundGate =
    record.publicationIntent &&
    Boolean(record.gateReport?.length) &&
    isPublicationGateWindowOpen(record.entryAt, now);

  if (canReuseBoundGate && record.gateReport) {
    return record.gateReport;
  }

  // Ordinary trades, expired publication windows, or missing bindings need a
  // fresh system gate. Failure rejects publication but never unwinds the trade.
  const gated = await runPublicationGateForProduct({
    toAsset: record.toAsset,
    destChain: record.destChain,
    checkRouter: options.checkRouter,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return gated.gateReport;
}

const publishInFlight = new Map<string, Promise<AgentPublishResult>>();

function publishKey(agentId: string, receiptId: string): string {
  return `${agentId}\0${receiptId}`;
}

/**
 * Publish a conviction from one successful, unique, agent-owned trade receipt.
 * Concurrent and retried calls return the same durable conviction.
 */
export async function publishAgentConviction(options: {
  agent: OwnedAgent;
  body: Record<string, unknown>;
  tradeReceipts: AgentTradeReceiptStore;
  convictions: AgentConvictionPersist;
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
}): Promise<AgentPublishResult> {
  const now = options.now?.() ?? new Date();
  let parsed: AgentPublishInput;
  try {
    parsed = parseAgentPublishInput(options.body, {
      publishedAt: now.toISOString(),
    });
  } catch (error) {
    if (error instanceof AgentPublishError) return error.toBody();
    throw error;
  }

  const key = publishKey(options.agent.agentId, parsed.receiptId);
  const existingFlight = publishInFlight.get(key);
  if (existingFlight) return existingFlight;

  const run = runPublishAgentConviction({
    ...options,
    input: parsed,
    now: () => now,
  });
  publishInFlight.set(key, run);
  try {
    return await run;
  } finally {
    publishInFlight.delete(key);
  }
}

async function runPublishAgentConviction(options: {
  agent: OwnedAgent;
  input: AgentPublishInput;
  tradeReceipts: AgentTradeReceiptStore;
  convictions: AgentConvictionPersist;
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  fetchImpl?: typeof fetch;
  now: () => Date;
  randomId?: () => string;
}): Promise<AgentPublishResult> {
  try {
    // ADR 0048: existing idempotent result before lifecycle / policy re-checks.
    const existingRecord = await options.tradeReceipts.get(
      options.input.receiptId,
    );
    if (
      existingRecord &&
      existingRecord.agentId === options.agent.agentId &&
      existingRecord.publishedEntryId
    ) {
      const existing = await options.convictions.get(
        existingRecord.publishedEntryId,
      );
      if (existing) {
        return {
          ok: true,
          entryId: existing.entryId,
          receiptId: options.input.receiptId,
          entry: existing,
        };
      }
    }
    if (options.convictions.getByReceiptSlug) {
      const bySlug = await options.convictions.getByReceiptSlug(
        options.input.receiptId,
      );
      if (bySlug && bySlug.authorship?.agentId === options.agent.agentId) {
        return {
          ok: true,
          entryId: bySlug.entryId,
          receiptId: options.input.receiptId,
          entry: bySlug,
        };
      }
    }

    assertPublishLifecycle(options.agent);
    assertPublishEnabled(options.agent);

    const record = assertReceiptPublishable(
      existingRecord,
      options.agent.agentId,
      options.input.receiptId,
    );

    const now = options.now();
    const gateReport = await resolveGateReport({
      record,
      now,
      checkRouter: options.checkRouter,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    const failed = failedCheckName(gateReport);
    if (failed) {
      return {
        ok: false,
        code: "gate_failed",
        message: `Publication gate failed: ${failed}`,
        receiptId: record.receiptId,
        gateReport,
      };
    }

    const publishedAt = now.toISOString();
    const entryId = options.randomId?.() ?? generateConvictionEntryId();
    const trade = tradeToConvictionTrade(
      record.intent,
      tradeQuoteFromReceipt(record),
      record.sizeUsd,
      record.receipt,
    );

    const authorship = authorshipSnapshot(options.agent);
    const entry = buildConviction({
      handle: authorship.handle,
      thesis: options.input.thesis,
      trade,
      receiptSlug: record.receiptId,
      whyNow: options.input.whyNow,
      whatBreaksIt: options.input.whatBreaksIt,
      gateReport,
      createdAt: publishedAt,
      authorship,
    });
    // Keep entryId stable for the consume CAS when randomId is injected in tests.
    entry.entryId = entryId;

    const consumed = await options.tradeReceipts.consumeForPublish({
      receiptId: record.receiptId,
      agentId: options.agent.agentId,
      entryId,
      consumedAt: publishedAt,
    });
    if (!consumed) {
      // Concurrent winner — return their durable conviction.
      const again = await options.tradeReceipts.get(record.receiptId);
      if (again?.publishedEntryId) {
        const winner = await options.convictions.get(again.publishedEntryId);
        if (winner) {
          return {
            ok: true,
            entryId: winner.entryId,
            receiptId: record.receiptId,
            entry: winner,
          };
        }
      }
      return {
        ok: false,
        code: "receipt_not_publishable",
        message: "That receipt has already been published.",
        receiptId: record.receiptId,
      };
    }

    try {
      await options.convictions.save(entry);
    } catch (error) {
      return {
        ok: false,
        code: "unavailable",
        message:
          error instanceof Error
            ? error.message
            : "Conviction persistence failed after receipt consume.",
        receiptId: record.receiptId,
      };
    }

    return {
      ok: true,
      entryId: entry.entryId,
      receiptId: record.receiptId,
      entry,
    };
  } catch (error) {
    if (error instanceof AgentPublishError) return error.toBody();
    return {
      ok: false,
      code: "unavailable",
      message:
        error instanceof Error
          ? error.message
          : "Could not publish the conviction.",
      receiptId: options.input.receiptId,
    };
  }
}

/** In-memory conviction persist for publish unit tests. */
export class MemoryAgentConvictionPersist implements AgentConvictionPersist {
  private readonly byId = new Map<string, ConvictionEntry>();
  private readonly byReceipt = new Map<string, string>();

  async save(entry: ConvictionEntry): Promise<void> {
    this.byId.set(entry.entryId, structuredClone(entry));
    if (entry.receiptSlug) {
      this.byReceipt.set(entry.receiptSlug, entry.entryId);
    }
  }

  async get(entryId: string): Promise<ConvictionEntry | null> {
    const stored = this.byId.get(entryId);
    return stored ? structuredClone(stored) : null;
  }

  async getByReceiptSlug(
    receiptSlug: string,
  ): Promise<ConvictionEntry | null> {
    const entryId = this.byReceipt.get(receiptSlug);
    if (!entryId) return null;
    return this.get(entryId);
  }

  clear(): void {
    this.byId.clear();
    this.byReceipt.clear();
  }
}
