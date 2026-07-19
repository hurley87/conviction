// Deterministic mock quote → execute → receipt engine (issue #55).
// Same write precedence and quote-before-execute contract as live.
// Offline only — no remote trading providers, local secrets, or fund movement.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { MOCK_FINALITY_RECEIPT_FIXTURES } from "./mock-fixtures.js";
import type { ExecutionLifecycle } from "./agent-reads-contract.js";

export const MOCK_QUOTE_TTL_MS = 60_000;
export const MOCK_FEE_RATE = 0.005;
export const MOCK_FLOOR_TOLERANCE = 0.01;

export const MCP_TRADE_ASSETS = [
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
  "arb",
] as const;

export type McpTradeAsset = (typeof MCP_TRADE_ASSETS)[number];
export type DestChain = "Arbitrum" | "Base";

export type MockAgentStatus =
  | "provisioning"
  | "active"
  | "disabled"
  | "capped"
  | "retiring"
  | "retired";

export type MockAgentPolicy = {
  agentId: string;
  handle: string;
  status: MockAgentStatus;
  actionPolicy: { trade: boolean; back: boolean; publish: boolean };
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  balanceUsd: number;
};

export type MockTradeQuoteRecord = {
  quoteId: string;
  agentId: string;
  quoteFingerprint: string;
  toAsset: McpTradeAsset;
  fromAsset?: McpTradeAsset;
  sizeUsd: number;
  destChain: DestChain;
  publicationIntent: boolean;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
};

export type MockReceipt = {
  slug: string;
  summary: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  legs: Array<{ chain: string; txHash: string; explorerUrl: string }>;
};

export type MockExecuteSuccess = {
  ok: true;
  outcome: "finalized";
  mode: "mock";
  receiptId: string;
  quoteId: string;
  quoteFingerprint: string;
  transactionId: string;
  summary: string;
  receipt: MockReceipt;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  idempotencyKey: string;
};

export type MockExecuteErrorCode =
  | "invalid_input"
  | "lifecycle_blocked"
  | "action_disabled"
  | "quote_not_found"
  | "quote_expired"
  | "quote_mismatch"
  | "insufficient_balance"
  | "spend_limit_exceeded"
  | "price_floor_breached"
  | "unsupported_asset"
  | "arbitrary_token_rejected"
  | "unavailable";

export type MockExecuteError = {
  ok: false;
  mode: "mock";
  code: MockExecuteErrorCode;
  message: string;
  action?: "trade" | "back";
  quoteId?: string;
  fields?: Array<{ field: string; code: string; message: string }>;
};

export type MockExecuteResult = MockExecuteSuccess | MockExecuteError;

export type MockQuoteSuccess = {
  ok: true;
  mode: "mock";
  quoteId: string;
  action: "trade";
  quoteFingerprint: string;
  issuedAt: string;
  serverTime: string;
  expiresAt: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  destChain: DestChain;
  toAsset: McpTradeAsset;
  sizeUsd: number;
  publicationIntent: boolean;
};

export type MockQuoteResult = MockQuoteSuccess | MockExecuteError;

export type MockReceiptGetResult =
  | {
      ok: true;
      mode: "mock";
      receiptId: string;
      outcome: "finalized";
      receipt: MockReceipt;
      entryAt: string;
      execution: null;
    }
  | {
      ok: true;
      mode: "mock";
      receiptId: string;
      outcome:
        | "submitted"
        | "pending"
        | "partial"
        | "failed"
        | "needs_attention";
      receipt: null;
      entryAt: null;
      execution: ExecutionLifecycle;
    }
  | MockExecuteError;

export type MockPublishableReceipt = {
  receiptId: string;
  agentId: string;
  quoteId: string;
  toAsset: McpTradeAsset;
  fromAsset?: McpTradeAsset;
  destChain: DestChain;
  sizeUsd: number;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  sourceChain: string;
  publicationIntent: boolean;
  entryAt: string;
  publishable: boolean;
  publishedEntryId?: string;
};

export type MockBackerAttribution = {
  handle: string;
  authorship?: {
    agentId: string;
    authorKind: "agent";
    handle: string;
    operatorHandle: string;
  };
};

export type MockConvictionEntry = {
  entryId: string;
  handle: string;
  thesis: string;
  trade: {
    fromAsset: string;
    fromChain: string;
    toAsset: string;
    toChain: DestChain;
    sizeUsd: number;
  };
  createdAt: string;
  backedBy: string[];
  backerAttributions?: MockBackerAttribution[];
  receiptSlug: string;
  whyNow: Array<{ at: string; event: string }>;
  whatBreaksIt: string;
  gateReport: Array<{
    id: "liquidity" | "contract" | "routability";
    name: string;
    passed: boolean;
    detail?: string;
  }>;
  authorship: {
    agentId: string;
    authorKind: "agent";
    handle: string;
    operatorHandle: string;
  };
};

export type MockPublishSuccess = {
  ok: true;
  mode: "mock";
  entryId: string;
  receiptId: string;
  entry: MockConvictionEntry;
};

export type MockPublishErrorCode =
  | MockExecuteErrorCode
  | "receipt_not_found"
  | "receipt_not_publishable"
  | "gate_failed";

export type MockPublishError = {
  ok: false;
  mode: "mock";
  code: MockPublishErrorCode;
  message: string;
  action?: "publish";
  receiptId?: string;
  fields?: Array<{ field: string; code: string; message: string }>;
};

export type MockPublishResult = MockPublishSuccess | MockPublishError;

export type MockBackQuoteRecord = {
  quoteId: string;
  agentId: string;
  action: "back";
  entryId: string;
  quoteFingerprint: string;
  toAsset: McpTradeAsset;
  sizeUsd: number;
  destChain: DestChain;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  targetFingerprint: string;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
};

export type MockBackSuccess = MockExecuteSuccess & {
  action: "back";
  entryId: string;
  backRecordId: string;
  reconciliationState: "complete" | "pending_sync";
  authorship: {
    agentId: string;
    authorKind: "agent";
    handle: string;
    operatorHandle: string;
  };
  code?: "executed_pending_sync";
};

export type MockBackResult = MockBackSuccess | MockExecuteError;

export type MockBackRecord = {
  backRecordId: string;
  entryId: string;
  receiptId: string;
  reconciliationState: "complete" | "pending_sync";
  authorship: MockBackSuccess["authorship"];
};

type DurableState = {
  policy: MockAgentPolicy;
  quotes: Record<string, MockTradeQuoteRecord>;
  backQuotes: Record<string, MockBackQuoteRecord>;
  backRecords: Record<string, MockBackRecord>;
  backIdempotency: Record<string, MockBackResult>;
  idempotency: Record<string, MockExecuteResult>;
  receipts: Record<string, { receipt: MockReceipt; entryAt: string }>;
  tradeReceipts: Record<string, MockPublishableReceipt>;
  convictions: Record<string, MockConvictionEntry>;
  /** Active spend reservations (not yet committed to lifetimeSpendUsd). */
  reservedSpendUsd: number;
};

/** Seed conviction agents can back in mock mode. */
export const MOCK_BACKABLE_ENTRY: MockConvictionEntry = {
  entryId: "mock-conviction-eth-arb",
  handle: "desk",
  thesis: "ETH remains the settlement asset for the EVM spine.",
  trade: {
    fromAsset: "cash",
    fromChain: "Arbitrum",
    toAsset: "eth",
    toChain: "Arbitrum",
    sizeUsd: 25,
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  backedBy: [],
  receiptSlug: "mock-desk-eth",
  whyNow: [{ at: "2026-07-01T00:00:00.000Z", event: "Spine liquidity deepens." }],
  whatBreaksIt: "A sustained ETH structural break.",
  gateReport: [
    {
      id: "liquidity",
      name: "Liquidity depth",
      passed: true,
    },
    {
      id: "contract",
      name: "Contract verification",
      passed: true,
    },
    {
      id: "routability",
      name: "UA routability",
      passed: true,
    },
  ],
  authorship: {
    agentId: "00000000-0000-4000-8000-000000000001",
    authorKind: "agent",
    handle: "desk",
    operatorHandle: "conviction",
  },
};

function destExplorerUrl(destChain: DestChain, txHash: string): string {
  switch (destChain) {
    case "Arbitrum":
      return `https://arbiscan.io/tx/${txHash}`;
    case "Base":
      return `https://basescan.org/tx/${txHash}`;
    default: {
      const _exhaustive: never = destChain;
      return _exhaustive;
    }
  }
}

const DEFAULT_POLICY: MockAgentPolicy = {
  agentId: "00000000-0000-4000-8000-000000000055",
  handle: "mock-conviction-agent",
  status: "active",
  actionPolicy: { trade: true, back: true, publish: true },
  maxTradeUsd: 25,
  spendBudgetUsd: 100,
  lifetimeSpendUsd: 0,
  balanceUsd: 242.5,
};

const ALLOWED_QUOTE_KEYS = new Set([
  "toAsset",
  "fromAsset",
  "sizeUsd",
  "fraction",
  "destChain",
  "publicationIntent",
]);

function isMcpTradeAsset(value: unknown): value is McpTradeAsset {
  return (
    typeof value === "string" &&
    (MCP_TRADE_ASSETS as readonly string[]).includes(value)
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

function hashFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function quoteEconomics(sizeUsd: number, stale = false) {
  const feeUsd = Number((sizeUsd * MOCK_FEE_RATE).toFixed(6));
  const dollarsOut = stale
    ? Number((sizeUsd * 0.97).toFixed(6))
    : Number((sizeUsd - feeUsd).toFixed(6));
  const floorUsd = Number((dollarsOut * (1 - MOCK_FLOOR_TOLERANCE)).toFixed(6));
  // When stale, dollarsOut is below the floor computed from a fresh non-stale quote.
  const agreedFloorUsd = Number(
    ((sizeUsd - feeUsd) * (1 - MOCK_FLOOR_TOLERANCE)).toFixed(6),
  );
  return {
    dollarsIn: sizeUsd,
    dollarsOut,
    feeUsd,
    floorUsd: stale ? agreedFloorUsd : floorUsd,
  };
}

export type MockTradeEngineOptions = {
  durableDir?: string;
  now?: () => Date;
  randomId?: () => string;
  simulateStaleQuote?: boolean;
  policy?: Partial<MockAgentPolicy>;
};

export class MockTradeEngine {
  private state: DurableState;
  private readonly durableDir?: string;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private simulateStaleQuote: boolean;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly idempotencyInFlight = new Map<
    string,
    Promise<MockExecuteResult>
  >();
  private readonly quoteInFlight = new Map<string, Promise<unknown>>();
  /** Test helper — counts attempted executions that passed claim. */
  providerAttempts = 0;

  constructor(options: MockTradeEngineOptions = {}) {
    if (options.durableDir !== undefined) {
      this.durableDir = options.durableDir;
    }
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => randomUUID());
    this.simulateStaleQuote = options.simulateStaleQuote ?? false;
    this.state = {
      policy: { ...DEFAULT_POLICY, ...options.policy },
      quotes: {},
      backQuotes: {},
      backRecords: {},
      backIdempotency: {},
      idempotency: {},
      receipts: {},
      tradeReceipts: {},
      convictions: {
        [MOCK_BACKABLE_ENTRY.entryId]: structuredClone(MOCK_BACKABLE_ENTRY),
      },
      reservedSpendUsd: 0,
    };
  }

  static async create(
    options: MockTradeEngineOptions = {},
  ): Promise<MockTradeEngine> {
    const engine = new MockTradeEngine(options);
    await engine.load();
    return engine;
  }

  getPolicy(): MockAgentPolicy {
    return { ...this.state.policy };
  }

  /** Test helper — inspect a conviction after mock back attribution. */
  getConvictionForTests(entryId: string): MockConvictionEntry | null {
    const entry = this.state.convictions[entryId];
    return entry ? structuredClone(entry) : null;
  }

  setPolicy(patch: Partial<MockAgentPolicy>): void {
    this.state.policy = { ...this.state.policy, ...patch };
  }

  setSimulateStaleQuote(value: boolean): void {
    this.simulateStaleQuote = value;
  }

  remainingBudgetUsd(): number {
    const policy = this.state.policy;
    return Math.max(
      0,
      policy.spendBudgetUsd -
        policy.lifetimeSpendUsd -
        this.state.reservedSpendUsd,
    );
  }

  accountStatus() {
    const policy = this.state.policy;
    return {
      ok: true as const,
      mode: "mock" as const,
      status: policy.status === "active" ? ("ready" as const) : policy.status,
      funded: policy.balanceUsd > 0,
      signingAvailable: false,
      agent: {
        handle: policy.handle,
        address: null,
        agentId: policy.agentId,
        actionPolicy: policy.actionPolicy,
        maxTradeUsd: policy.maxTradeUsd,
        spendBudgetUsd: policy.spendBudgetUsd,
        lifetimeSpendUsd: policy.lifetimeSpendUsd,
        remainingBudgetUsd: this.remainingBudgetUsd(),
        balanceUsd: policy.balanceUsd,
      },
    };
  }

  async quoteTrade(input: Record<string, unknown>): Promise<MockQuoteResult> {
    try {
      const parsed = this.parseQuoteInput(input);
      const issuedAt = this.now();
      const economics = quoteEconomics(parsed.sizeUsd, false);
      const quoteId = this.randomId();
      const quoteFingerprint = hashFingerprint({
        action: "trade",
        toAsset: parsed.toAsset,
        fromAsset: parsed.fromAsset ?? null,
        sizeUsd: parsed.sizeUsd,
        destChain: parsed.destChain,
        publicationIntent: parsed.publicationIntent,
        ...economics,
        sourceChain: "Base",
      });
      const record: MockTradeQuoteRecord = {
        quoteId,
        agentId: this.state.policy.agentId,
        quoteFingerprint,
        toAsset: parsed.toAsset,
        ...(parsed.fromAsset ? { fromAsset: parsed.fromAsset } : {}),
        sizeUsd: parsed.sizeUsd,
        destChain: parsed.destChain,
        publicationIntent: parsed.publicationIntent,
        dollarsIn: economics.dollarsIn,
        dollarsOut: economics.dollarsOut,
        feeUsd: economics.feeUsd,
        floorUsd: economics.floorUsd,
        sourceChain: "Base",
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + MOCK_QUOTE_TTL_MS).toISOString(),
        used: false,
      };
      this.state.quotes[quoteId] = record;
      await this.persist();
      return {
        ok: true,
        mode: "mock",
        quoteId: record.quoteId,
        action: "trade",
        quoteFingerprint: record.quoteFingerprint,
        issuedAt: record.issuedAt,
        serverTime: issuedAt.toISOString(),
        expiresAt: record.expiresAt,
        dollarsIn: record.dollarsIn,
        dollarsOut: record.dollarsOut,
        feeUsd: record.feeUsd,
        floorUsd: record.floorUsd,
        sourceChain: record.sourceChain,
        destChain: record.destChain,
        toAsset: record.toAsset,
        sizeUsd: record.sizeUsd,
        publicationIntent: record.publicationIntent,
      };
    } catch (error) {
      return this.errorFromUnknown(error);
    }
  }

  async executeTrade(input: {
    quoteId: string;
    idempotencyKey: string;
  }): Promise<MockExecuteResult> {
    const quoteId =
      typeof input.quoteId === "string" ? input.quoteId.trim() : "";
    const idempotencyKey =
      typeof input.idempotencyKey === "string"
        ? input.idempotencyKey.trim()
        : "";
    if (!quoteId) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Provide the quoteId returned by conviction_quote_trade.",
        fields: [
          {
            field: "quoteId",
            code: "required",
            message: "Provide the quoteId returned by conviction_quote_trade.",
          },
        ],
      };
    }
    if (!idempotencyKey) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Provide a durable idempotencyKey for this execution.",
        fields: [
          {
            field: "idempotencyKey",
            code: "required",
            message: "Provide a durable idempotencyKey for this execution.",
          },
        ],
      };
    }

    const flightKey = `${this.state.policy.agentId}\0${idempotencyKey}`;
    const existing = this.idempotencyInFlight.get(flightKey);
    if (existing) return existing;

    const run = this.runExecute(quoteId, idempotencyKey);
    this.idempotencyInFlight.set(flightKey, run);
    try {
      return await run;
    } finally {
      this.idempotencyInFlight.delete(flightKey);
    }
  }

  private async withQuoteLock<T>(
    quoteId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = `${this.state.policy.agentId}\0quote\0${quoteId}`;
    const prior = this.quoteInFlight.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prior.catch(() => undefined).then(() => gate);
    this.quoteInFlight.set(key, chained);
    await prior.catch(() => undefined);
    try {
      return await run();
    } finally {
      release();
      if (this.quoteInFlight.get(key) === chained) {
        this.quoteInFlight.delete(key);
      }
    }
  }

  async publishConviction(input: {
    receiptId: string;
    thesis: string;
    whyNow: string;
    whatBreaksIt: string;
  }): Promise<MockPublishResult> {
    const receiptId =
      typeof input.receiptId === "string" ? input.receiptId.trim() : "";
    const thesis = typeof input.thesis === "string" ? input.thesis.trim() : "";
    const whyNow = typeof input.whyNow === "string" ? input.whyNow.trim() : "";
    const whatBreaksIt =
      typeof input.whatBreaksIt === "string" ? input.whatBreaksIt.trim() : "";

    const fields: NonNullable<MockPublishError["fields"]> = [];
    if (!receiptId) {
      fields.push({
        field: "receiptId",
        code: "required",
        message: "Provide the receiptId from a successful mock trade.",
      });
    }
    if (!thesis) {
      fields.push({
        field: "thesis",
        code: "required",
        message: "Provide a thesis for the conviction.",
      });
    }
    if (!whyNow) {
      fields.push({
        field: "whyNow",
        code: "required",
        message: "Provide whyNow as a non-empty string.",
      });
    }
    if (!whatBreaksIt) {
      fields.push({
        field: "whatBreaksIt",
        code: "required",
        message: "Provide whatBreaksIt as a non-empty falsifier string.",
      });
    }
    if (fields.length > 0) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Publish input is incomplete or invalid.",
        fields,
      };
    }

    const trade = this.state.tradeReceipts[receiptId];
    if (trade?.publishedEntryId) {
      const existing = this.state.convictions[trade.publishedEntryId];
      if (existing) {
        return {
          ok: true,
          mode: "mock",
          entryId: existing.entryId,
          receiptId,
          entry: structuredClone(existing),
        };
      }
    }

    if (this.state.policy.status !== "active") {
      return {
        ok: false,
        mode: "mock",
        code: "lifecycle_blocked",
        message: `Agent @${this.state.policy.handle} is ${this.state.policy.status} and cannot publish convictions.`,
      };
    }
    if (!this.state.policy.actionPolicy.publish) {
      return {
        ok: false,
        mode: "mock",
        code: "action_disabled",
        message:
          "Publish is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
        action: "publish",
      };
    }

    if (!trade) {
      return {
        ok: false,
        mode: "mock",
        code: "receipt_not_found",
        message: "No successful agent trade receipt matches that receiptId.",
        receiptId,
      };
    }
    if (trade.agentId !== this.state.policy.agentId || !trade.publishable) {
      return {
        ok: false,
        mode: "mock",
        code: "receipt_not_publishable",
        message: "That receipt is not uniquely publishable for this agent.",
        receiptId,
      };
    }

    const publishedAt = this.now().toISOString();
    const entryId = this.randomId();
    const entry: MockConvictionEntry = {
      entryId,
      handle: this.state.policy.handle,
      thesis,
      trade: {
        fromAsset: trade.fromAsset ?? "cash",
        fromChain: trade.sourceChain,
        toAsset: trade.toAsset,
        toChain: trade.destChain,
        sizeUsd: trade.sizeUsd,
      },
      createdAt: publishedAt,
      backedBy: [],
      receiptSlug: receiptId,
      whyNow: [{ at: publishedAt, event: whyNow }],
      whatBreaksIt,
      gateReport: [
        {
          id: "liquidity",
          name: "Liquidity depth",
          passed: true,
          detail: "Mock product primary gate.",
        },
        {
          id: "contract",
          name: "Contract verification",
          passed: true,
          detail: "Mock product primary gate.",
        },
        {
          id: "routability",
          name: "UA routability",
          passed: true,
          detail: "Mock product primary gate.",
        },
      ],
      authorship: {
        agentId: this.state.policy.agentId,
        authorKind: "agent",
        handle: this.state.policy.handle,
        operatorHandle: "mock-operator",
      },
    };

    trade.publishable = false;
    trade.publishedEntryId = entryId;
    this.state.tradeReceipts[receiptId] = trade;
    this.state.convictions[entryId] = entry;
    await this.persist();

    return {
      ok: true,
      mode: "mock",
      entryId,
      receiptId,
      entry: structuredClone(entry),
    };
  }

  async quoteBack(input: Record<string, unknown>): Promise<
    | {
        ok: true;
        mode: "mock";
        quoteId: string;
        action: "back";
        quoteFingerprint: string;
        issuedAt: string;
        serverTime: string;
        expiresAt: string;
        dollarsIn: number;
        dollarsOut: number;
        feeUsd: number;
        floorUsd: number;
        sourceChain: string;
        destChain: DestChain;
        toAsset: McpTradeAsset;
        sizeUsd: number;
        publicationIntent: false;
        entryId: string;
        targetFingerprint: string;
      }
    | MockExecuteError
  > {
    const entryId =
      typeof input.entryId === "string" ? input.entryId.trim() : "";
    if (!entryId) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Provide the entryId of the canonical conviction to back.",
        fields: [
          {
            field: "entryId",
            code: "required",
            message: "Provide the entryId of the canonical conviction to back.",
          },
        ],
      };
    }

    const forbidden = Object.keys(input).filter(
      (key) => !["entryId", "dollarsIn", "fraction"].includes(key),
    );
    if (forbidden.length > 0) {
      return {
        ok: false,
        mode: "mock",
        code: "arbitrary_token_rejected",
        message:
          "Back quotes derive the target from the canonical conviction. Token addresses and destination overrides are rejected.",
        fields: forbidden.map((field) => ({
          field,
          code: "forbidden_field",
          message: `Remove "${field}". The approved target comes from the published conviction.`,
        })),
      };
    }

    const hasDollars = input.dollarsIn !== undefined;
    const hasFraction = input.fraction !== undefined;
    if (hasDollars === hasFraction) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message:
          "Provide exactly one of dollarsIn (positive dollars) or fraction (0–1 of balance).",
        fields: [
          {
            field: "dollarsIn|fraction",
            code: "size_required",
            message:
              "Provide exactly one of dollarsIn or fraction — not both, not neither.",
          },
        ],
      };
    }

    let requestedUsd: number;
    if (hasDollars) {
      if (
        typeof input.dollarsIn !== "number" ||
        !Number.isFinite(input.dollarsIn) ||
        input.dollarsIn <= 0
      ) {
        return {
          ok: false,
          mode: "mock",
          code: "invalid_input",
          message: "Provide a positive dollarsIn.",
          fields: [
            {
              field: "dollarsIn",
              code: "invalid_value",
              message: "dollarsIn must be a finite positive number.",
            },
          ],
        };
      }
      requestedUsd = input.dollarsIn;
    } else {
      if (
        typeof input.fraction !== "number" ||
        !Number.isFinite(input.fraction) ||
        input.fraction <= 0 ||
        input.fraction > 1
      ) {
        return {
          ok: false,
          mode: "mock",
          code: "invalid_input",
          message: "fraction must be greater than 0 and at most 1.",
          fields: [
            {
              field: "fraction",
              code: "invalid_value",
              message: "fraction must be greater than 0 and at most 1.",
            },
          ],
        };
      }
      requestedUsd = Number(
        (this.state.policy.balanceUsd * input.fraction).toFixed(6),
      );
      if (!(requestedUsd > 0)) {
        return {
          ok: false,
          mode: "mock",
          code: "invalid_input",
          message:
            "Account balance is empty — provide dollarsIn instead of fraction.",
          fields: [
            {
              field: "dollarsIn",
              code: "size_required",
              message:
                "Account balance is empty — provide dollarsIn instead of fraction.",
            },
          ],
        };
      }
    }

    const entry = this.state.convictions[entryId];
    if (!entry) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "No canonical conviction matches that entryId.",
        fields: [
          {
            field: "entryId",
            code: "conviction_not_found",
            message: "Provide an entryId from the mock conviction network.",
          },
        ],
      };
    }

    const toAsset = isMcpTradeAsset(entry.trade.toAsset)
      ? entry.trade.toAsset
      : "eth";
    const sizeUsd = Math.min(requestedUsd, 25);
    const economics = quoteEconomics(sizeUsd, false);
    const issuedAt = this.now();
    const quoteId = this.randomId();
    const targetFingerprint = hashFingerprint({
      entryId,
      toAsset,
      destChain: entry.trade.toChain,
    });
    const quoteFingerprint = hashFingerprint({
      action: "back",
      entryId,
      toAsset,
      sizeUsd,
      destChain: entry.trade.toChain,
      targetFingerprint,
      ...economics,
      sourceChain: "Base",
    });
    const record: MockBackQuoteRecord = {
      quoteId,
      agentId: this.state.policy.agentId,
      action: "back",
      entryId,
      quoteFingerprint,
      toAsset,
      sizeUsd,
      destChain: entry.trade.toChain,
      dollarsIn: economics.dollarsIn,
      dollarsOut: economics.dollarsOut,
      feeUsd: economics.feeUsd,
      floorUsd: economics.floorUsd,
      sourceChain: "Base",
      targetFingerprint,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + MOCK_QUOTE_TTL_MS).toISOString(),
      used: false,
    };
    this.state.backQuotes[quoteId] = record;
    await this.persist();
    return {
      ok: true,
      mode: "mock",
      quoteId: record.quoteId,
      action: "back",
      quoteFingerprint: record.quoteFingerprint,
      issuedAt: record.issuedAt,
      serverTime: issuedAt.toISOString(),
      expiresAt: record.expiresAt,
      dollarsIn: record.dollarsIn,
      dollarsOut: record.dollarsOut,
      feeUsd: record.feeUsd,
      floorUsd: record.floorUsd,
      sourceChain: record.sourceChain,
      destChain: record.destChain,
      toAsset: record.toAsset,
      sizeUsd: record.sizeUsd,
      publicationIntent: false,
      entryId: record.entryId,
      targetFingerprint: record.targetFingerprint,
    };
  }

  async backConviction(input: {
    quoteId: string;
    idempotencyKey: string;
  }): Promise<MockBackResult> {
    const quoteId =
      typeof input.quoteId === "string" ? input.quoteId.trim() : "";
    const idempotencyKey =
      typeof input.idempotencyKey === "string"
        ? input.idempotencyKey.trim()
        : "";
    if (!quoteId || !idempotencyKey) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Provide quoteId and idempotencyKey.",
      };
    }

    const prior = this.state.backIdempotency[idempotencyKey];
    if (prior) return structuredClone(prior);

    const policy = this.state.policy;
    if (policy.status !== "active") {
      const blocked: MockBackResult = {
        ok: false,
        mode: "mock",
        code: "lifecycle_blocked",
        message: `Agent @${policy.handle} is ${policy.status} and cannot back convictions.`,
      };
      this.state.backIdempotency[idempotencyKey] = blocked;
      await this.persist();
      return structuredClone(blocked);
    }
    if (!policy.actionPolicy.back) {
      const disabled: MockBackResult = {
        ok: false,
        mode: "mock",
        code: "action_disabled",
        message:
          "Back is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
        action: "back",
      };
      this.state.backIdempotency[idempotencyKey] = disabled;
      await this.persist();
      return structuredClone(disabled);
    }

    const quote = this.state.backQuotes[quoteId];
    if (!quote || quote.agentId !== policy.agentId) {
      const missing: MockBackResult = {
        ok: false,
        mode: "mock",
        code: "quote_not_found",
        message: "No back quote matches that quoteId for this agent.",
        quoteId,
      };
      this.state.backIdempotency[idempotencyKey] = missing;
      await this.persist();
      return structuredClone(missing);
    }
    if (quote.used) {
      const used: MockBackResult = {
        ok: false,
        mode: "mock",
        code: "quote_mismatch",
        message: "That quote has already been consumed.",
        quoteId,
      };
      this.state.backIdempotency[idempotencyKey] = used;
      await this.persist();
      return structuredClone(used);
    }
    if (new Date(quote.expiresAt).getTime() <= this.now().getTime()) {
      const expired: MockBackResult = {
        ok: false,
        mode: "mock",
        code: "quote_expired",
        message: `Quote ${quote.quoteId} expired at ${quote.expiresAt}. Call conviction_quote_back again.`,
        quoteId,
      };
      this.state.backIdempotency[idempotencyKey] = expired;
      await this.persist();
      return structuredClone(expired);
    }

    quote.used = true;
    this.providerAttempts += 1;
    const receiptId = this.randomId();
    const backRecordId = this.randomId();
    const receipt: MockReceipt = {
      slug: receiptId,
      summary: `Backed — $${quote.dollarsIn.toFixed(2)} copied into ${quote.toAsset.toUpperCase()}.`,
      dollarsIn: quote.dollarsIn,
      dollarsOut: quote.dollarsOut,
      feeUsd: quote.feeUsd,
      legs: [
        {
          chain: "Base",
          txHash: `0xmockbacksrc${receiptId.replace(/-/g, "").slice(0, 12)}`,
          explorerUrl: "https://basescan.org/tx/0xmock",
        },
        {
          chain: quote.destChain,
          txHash: `0xmockbackdst${receiptId.replace(/-/g, "").slice(0, 12)}`,
          explorerUrl: destExplorerUrl(quote.destChain, "0xmock"),
        },
      ],
    };
    this.state.receipts[receiptId] = {
      receipt,
      entryAt: this.now().toISOString(),
    };
    this.state.policy.lifetimeSpendUsd += quote.dollarsIn;
    this.state.policy.balanceUsd = Math.max(
      0,
      this.state.policy.balanceUsd - quote.dollarsIn,
    );

    const authorship = {
      agentId: policy.agentId,
      authorKind: "agent" as const,
      handle: policy.handle,
      operatorHandle: "mock-operator",
    };

    // Durable back record before attribution (ADR 0028).
    this.state.backRecords[backRecordId] = {
      backRecordId,
      entryId: quote.entryId,
      receiptId,
      reconciliationState: "pending_sync",
      authorship,
    };

    const conviction = this.state.convictions[quote.entryId];
    if (conviction) {
      if (!conviction.backedBy.includes(policy.handle)) {
        conviction.backedBy = [...conviction.backedBy, policy.handle];
      }
      const existing = conviction.backerAttributions ?? [];
      const idx = existing.findIndex((row) => row.handle === policy.handle);
      const attribution: MockBackerAttribution = {
        handle: policy.handle,
        authorship,
      };
      if (idx < 0) {
        conviction.backerAttributions = [...existing, attribution];
      } else if (!existing[idx]?.authorship) {
        const next = [...existing];
        next[idx] = attribution;
        conviction.backerAttributions = next;
      }
      this.state.backRecords[backRecordId]!.reconciliationState = "complete";
    }

    const success: MockBackSuccess = {
      ok: true,
      outcome: "finalized",
      mode: "mock",
      receiptId,
      quoteId: quote.quoteId,
      quoteFingerprint: quote.quoteFingerprint,
      transactionId: `mock-back-${receiptId}`,
      summary: receipt.summary,
      receipt,
      dollarsIn: quote.dollarsIn,
      dollarsOut: quote.dollarsOut,
      feeUsd: quote.feeUsd,
      idempotencyKey,
      action: "back",
      entryId: quote.entryId,
      backRecordId,
      reconciliationState:
        this.state.backRecords[backRecordId]!.reconciliationState,
      authorship,
      ...(this.state.backRecords[backRecordId]!.reconciliationState !== "complete"
        ? { code: "executed_pending_sync" as const }
        : {}),
    };
    this.state.backIdempotency[idempotencyKey] = success;
    await this.persist();
    return structuredClone(success);
  }

  async getReceipt(receiptId: string): Promise<MockReceiptGetResult> {
    const id = typeof receiptId === "string" ? receiptId.trim() : "";
    if (!id) {
      return {
        ok: false,
        mode: "mock",
        code: "invalid_input",
        message: "Provide a receiptId.",
        fields: [
          {
            field: "receiptId",
            code: "required",
            message: "Provide a receiptId.",
          },
        ],
      };
    }
    const stored = this.state.receipts[id];
    if (!stored) {
      const fixture =
        MOCK_FINALITY_RECEIPT_FIXTURES[
          id as keyof typeof MOCK_FINALITY_RECEIPT_FIXTURES
      ];
      if (fixture) {
        return structuredClone(fixture) as unknown as MockReceiptGetResult;
      }
      return {
        ok: false,
        mode: "mock",
        code: "unavailable",
        message: "No mock receipt matches that receiptId.",
      };
    }
    return {
      ok: true,
      mode: "mock",
      receiptId: id,
      outcome: "finalized",
      receipt: structuredClone(stored.receipt),
      entryAt: stored.entryAt,
      execution: null,
    };
  }

  /** Test helper — count stored quotes (detect silent requotes). */
  quoteCount(): number {
    return Object.keys(this.state.quotes).length;
  }

  private async runExecute(
    quoteId: string,
    idempotencyKey: string,
  ): Promise<MockExecuteResult> {
    const prior = this.state.idempotency[idempotencyKey];
    if (prior) return structuredClone(prior);

    const persistResult = async (
      result: MockExecuteResult,
    ): Promise<MockExecuteResult> => {
      this.state.idempotency[idempotencyKey] = structuredClone(result);
      await this.persist();
      return structuredClone(result);
    };

    const policy = this.state.policy;
    if (policy.status !== "active") {
      return persistResult({
        ok: false,
        mode: "mock",
        code: "lifecycle_blocked",
        message: `Agent @${policy.handle} is ${policy.status} and cannot execute trades.`,
      });
    }
    if (!policy.actionPolicy.trade) {
      return persistResult({
        ok: false,
        mode: "mock",
        code: "action_disabled",
        message:
          "Trade is disabled for this agent. Only the operator can enable it through Agent Settings or the operator CLI.",
        action: "trade",
      });
    }

    return this.withQuoteLock(quoteId, async () => {
      const again = this.state.idempotency[idempotencyKey];
      if (again) return structuredClone(again);

      const quote = this.state.quotes[quoteId];
      if (!quote || quote.agentId !== policy.agentId) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "quote_not_found",
          message: "No trade quote matches that quoteId for this agent.",
          quoteId,
        });
      }
      if (new Date(quote.expiresAt).getTime() <= this.now().getTime()) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "quote_expired",
          message: `Quote ${quote.quoteId} expired at ${quote.expiresAt}. Call conviction_quote_trade again for a fresh quoteId.`,
          quoteId,
        });
      }
      if (quote.used) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "quote_mismatch",
          message: "That quote has already been consumed.",
          quoteId,
        });
      }

      if (quote.dollarsIn > policy.maxTradeUsd + 1e-9) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "spend_limit_exceeded",
          message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds the per-trade limit of $${policy.maxTradeUsd.toFixed(2)}.`,
          quoteId,
        });
      }
      const remaining = this.remainingBudgetUsd();
      if (quote.dollarsIn > remaining + 1e-9) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "spend_limit_exceeded",
          message: `Trade size $${quote.dollarsIn.toFixed(2)} exceeds remaining spend budget of $${remaining.toFixed(2)}.`,
          quoteId,
        });
      }
      if (policy.balanceUsd + 1e-9 < quote.dollarsIn) {
        return persistResult({
          ok: false,
          mode: "mock",
          code: "insufficient_balance",
          message: `Unified balance $${policy.balanceUsd.toFixed(2)} is below the quoted debit of $${quote.dollarsIn.toFixed(2)}.`,
          quoteId,
        });
      }

      // Claim + reserve before any execution side effect (ADR 0020).
      quote.used = true;
      this.state.reservedSpendUsd += quote.dollarsIn;
      this.providerAttempts += 1;

      const fresh = quoteEconomics(quote.sizeUsd, this.simulateStaleQuote);
      if (fresh.dollarsOut < quote.floorUsd) {
        this.state.reservedSpendUsd = Math.max(
          0,
          this.state.reservedSpendUsd - quote.dollarsIn,
        );
        return persistResult({
          ok: false,
          mode: "mock",
          code: "price_floor_breached",
          message:
            "Current execution cannot satisfy the quote's minimum-received floor. Call conviction_quote_trade for a new quoteId — execution never silently requotes.",
          quoteId,
        });
      }

      const receiptId = this.randomId();
      const transactionId = `mock-exec-${receiptId}`;
      const destTxHash = `0xmockdest${receiptId.replace(/-/g, "").slice(0, 16)}`;
      const sourceTxHash = `0xmocksource${receiptId.replace(/-/g, "").slice(0, 16)}`;
      const receipt: MockReceipt = {
        slug: receiptId,
        summary: `Done — $${quote.dollarsIn.toFixed(2)} moved. You now have $${fresh.dollarsOut.toFixed(2)} in ${quote.toAsset.toUpperCase()}.`,
        dollarsIn: quote.dollarsIn,
        dollarsOut: fresh.dollarsOut,
        feeUsd: fresh.feeUsd,
        legs: [
          {
            chain: "Base",
            txHash: sourceTxHash,
            explorerUrl: `https://basescan.org/tx/${sourceTxHash}`,
          },
          {
            chain: quote.destChain,
            txHash: destTxHash,
            explorerUrl: destExplorerUrl(quote.destChain, destTxHash),
          },
        ],
      };
      const entryAt = this.now().toISOString();
      this.state.receipts[receiptId] = {
        receipt,
        entryAt,
      };
      this.state.tradeReceipts[receiptId] = {
        receiptId,
        agentId: this.state.policy.agentId,
        quoteId: quote.quoteId,
        toAsset: quote.toAsset,
        ...(quote.fromAsset ? { fromAsset: quote.fromAsset } : {}),
        destChain: quote.destChain,
        sizeUsd: quote.sizeUsd,
        dollarsIn: quote.dollarsIn,
        dollarsOut: fresh.dollarsOut,
        feeUsd: fresh.feeUsd,
        sourceChain: quote.sourceChain,
        publicationIntent: quote.publicationIntent,
        entryAt,
        publishable: true,
      };
      this.state.policy.lifetimeSpendUsd += quote.dollarsIn;
      this.state.reservedSpendUsd = Math.max(
        0,
        this.state.reservedSpendUsd - quote.dollarsIn,
      );
      this.state.policy.balanceUsd = Math.max(
        0,
        this.state.policy.balanceUsd - quote.dollarsIn,
      );

      return persistResult({
        ok: true,
        outcome: "finalized",
        mode: "mock",
        receiptId,
        quoteId: quote.quoteId,
        quoteFingerprint: quote.quoteFingerprint,
        transactionId,
        summary: receipt.summary,
        receipt,
        dollarsIn: quote.dollarsIn,
        dollarsOut: fresh.dollarsOut,
        feeUsd: fresh.feeUsd,
        idempotencyKey,
      });
    });
  }

  private parseQuoteInput(input: Record<string, unknown>): {
    toAsset: McpTradeAsset;
    fromAsset?: McpTradeAsset;
    sizeUsd: number;
    destChain: DestChain;
    publicationIntent: boolean;
  } {
    const unknownKeys = Object.keys(input).filter(
      (key) => !ALLOWED_QUOTE_KEYS.has(key),
    );
    if (unknownKeys.length > 0) {
      const looksLikeToken = unknownKeys.some((key) =>
        /token|address|contract|chainId/i.test(key),
      );
      throw Object.assign(new Error("invalid quote fields"), {
        code: looksLikeToken ? "arbitrary_token_rejected" : "invalid_input",
        fields: unknownKeys.map((field) => ({
          field,
          code: looksLikeToken ? "forbidden_field" : "unknown_field",
          message: looksLikeToken
            ? `Remove "${field}". Use a named product asset instead.`
            : `Unknown field "${field}".`,
        })),
      });
    }

    if (!isMcpTradeAsset(input.toAsset)) {
      throw Object.assign(new Error("unsupported asset"), {
        code:
          input.toAsset === "token"
            ? "arbitrary_token_rejected"
            : "unsupported_asset",
        fields: [
          {
            field: "toAsset",
            code: "unsupported_asset",
            message: `Supported assets: ${MCP_TRADE_ASSETS.join(", ")}.`,
          },
        ],
      });
    }

    const hasSize = input.sizeUsd !== undefined;
    const hasFraction = input.fraction !== undefined;
    if (hasSize === hasFraction) {
      throw Object.assign(new Error("size required"), {
        code: "invalid_input",
        fields: [
          {
            field: "sizeUsd|fraction",
            code: "size_required",
            message:
              "Provide exactly one of sizeUsd or fraction — not both, not neither.",
          },
        ],
      });
    }

    let sizeUsd: number;
    if (hasSize) {
      if (
        typeof input.sizeUsd !== "number" ||
        !Number.isFinite(input.sizeUsd) ||
        input.sizeUsd <= 0
      ) {
        throw Object.assign(new Error("invalid sizeUsd"), {
          code: "invalid_input",
          fields: [
            {
              field: "sizeUsd",
              code: "invalid_value",
              message: "sizeUsd must be a finite positive number.",
            },
          ],
        });
      }
      sizeUsd = input.sizeUsd;
    } else {
      if (
        typeof input.fraction !== "number" ||
        !Number.isFinite(input.fraction) ||
        input.fraction <= 0 ||
        input.fraction > 1
      ) {
        throw Object.assign(new Error("invalid fraction"), {
          code: "invalid_input",
          fields: [
            {
              field: "fraction",
              code: "invalid_value",
              message: "fraction must be greater than 0 and at most 1.",
            },
          ],
        });
      }
      sizeUsd = Number(
        (this.state.policy.balanceUsd * input.fraction).toFixed(6),
      );
      if (sizeUsd <= 0) {
        throw Object.assign(new Error("fraction needs balance"), {
          code: "invalid_input",
          fields: [
            {
              field: "sizeUsd",
              code: "size_required",
              message:
                "Account balance is empty — provide sizeUsd instead of fraction.",
            },
          ],
        });
      }
    }

    let destChain: DestChain = "Arbitrum";
    if (input.destChain !== undefined) {
      if (input.destChain !== "Arbitrum" && input.destChain !== "Base") {
        throw Object.assign(new Error("unsupported chain"), {
          code: "invalid_input",
          fields: [
            {
              field: "destChain",
              code: "unsupported_chain",
              message: 'destChain must be "Arbitrum" or "Base".',
            },
          ],
        });
      }
      destChain = input.destChain;
    }

    let fromAsset: McpTradeAsset | undefined;
    if (input.fromAsset !== undefined) {
      if (!isMcpTradeAsset(input.fromAsset)) {
        throw Object.assign(new Error("unsupported fromAsset"), {
          code: "unsupported_asset",
          fields: [
            {
              field: "fromAsset",
              code: "unsupported_asset",
              message: `Supported assets: ${MCP_TRADE_ASSETS.join(", ")}.`,
            },
          ],
        });
      }
      fromAsset = input.fromAsset;
    }

    const publicationIntent =
      typeof input.publicationIntent === "boolean"
        ? input.publicationIntent
        : false;

    return {
      toAsset: input.toAsset,
      ...(fromAsset ? { fromAsset } : {}),
      sizeUsd,
      destChain,
      publicationIntent,
    };
  }

  private errorFromUnknown(error: unknown): MockExecuteError {
    if (error && typeof error === "object" && "code" in error) {
      const coded = error as {
        code: MockExecuteErrorCode;
        message?: string;
        fields?: MockExecuteError["fields"];
      };
      return {
        ok: false,
        mode: "mock",
        code: coded.code,
        message:
          typeof coded.message === "string" && coded.message
            ? coded.message
            : error instanceof Error
              ? error.message
              : "Mock quote failed.",
        ...(coded.fields ? { fields: coded.fields } : {}),
      };
    }
    return {
      ok: false,
      mode: "mock",
      code: "unavailable",
      message:
        error instanceof Error ? error.message : "Mock quote unavailable.",
    };
  }

  private statePath(): string | null {
    if (!this.durableDir) return null;
    return path.join(this.durableDir, "trade-state.json");
  }

  private async load(): Promise<void> {
    const filePath = this.statePath();
    if (!filePath) return;
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as DurableState;
      if (parsed && typeof parsed === "object") {
        this.state = {
          policy: { ...DEFAULT_POLICY, ...parsed.policy },
          quotes: parsed.quotes ?? {},
          backQuotes: parsed.backQuotes ?? {},
          backRecords: parsed.backRecords ?? {},
          backIdempotency: parsed.backIdempotency ?? {},
          idempotency: parsed.idempotency ?? {},
          receipts: parsed.receipts ?? {},
          tradeReceipts: parsed.tradeReceipts ?? {},
          convictions: {
            [MOCK_BACKABLE_ENTRY.entryId]: structuredClone(MOCK_BACKABLE_ENTRY),
            ...(parsed.convictions ?? {}),
          },
          // Reservations are process-local; never revive them across restart.
          reservedSpendUsd: 0,
        };
      }
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }

  private async persist(): Promise<void> {
    const filePath = this.statePath();
    if (!filePath) return;
    // Recover the chain after a failed write so later persists still run.
    const write = async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(this.state), "utf8");
      await rename(tempPath, filePath);
    };
    this.writeChain = this.writeChain.then(write, write);
    await this.writeChain;
  }
}
