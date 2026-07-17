// Structured MCP trade quoting — research-only, quote-before-execute substrate.
// Never invokes the natural-language intent parser (ADR 0030). Rejects caller
// TokenRef / contract addresses (ADR 0031). Caps expiry at 60s (ADR 0041).

import { createHash, randomUUID } from "node:crypto";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import { failedCheckName, runGateCheck } from "@/lib/gate";
import type { WarmUpRouteResult, WarmUpToken } from "@/lib/ua/warm-up";
import type { UAClient } from "@/lib/ua/types";
import {
  assetMatches,
  isBuyOnlyAsset,
  isProductAsset,
  toUaTokenType,
} from "@/lib/verbs/assets";
import { destChainId, isDestChain, tokenAddress } from "@/lib/verbs/chains";
import { DEFAULT_DEST_CHAIN, pickSettlementChain } from "@/lib/verbs/intent";
import type {
  DestChain,
  GateCheck,
  ProductAsset,
  TradeIntent,
  TradeQuote,
  UniversalBalance,
} from "@/lib/verbs/types";

/** Max quote lifetime from issuance (ADR 0041). */
export const QUOTE_MAX_TTL_MS = 60_000;

/** Default lifetime when the routing provider omits expiry. */
export const QUOTE_DEFAULT_TTL_MS = 60_000;

/** Gate module identity bound into publication-intent quotes (ADR 0033). */
export const PUBLICATION_GATE_VERSION = "gate-v1";

/** Named product assets allowed on direct MCP trade inputs (no `token`). */
export const MCP_TRADE_ASSETS = [
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
  "arb",
] as const satisfies readonly ProductAsset[];

export type McpTradeAsset = (typeof MCP_TRADE_ASSETS)[number];

export type StructuredTradeQuoteInput = {
  toAsset: McpTradeAsset;
  fromAsset?: McpTradeAsset;
  sizeUsd?: number;
  fraction?: number;
  destChain?: DestChain;
  publicationIntent?: boolean;
};

export type AgentTradeQuoteRecord = {
  quoteId: string;
  agentId: string;
  action: "trade";
  intentFingerprint: string;
  intent: TradeIntent;
  sizeUsd: number;
  publicationIntent: boolean;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  destChain: DestChain;
  toAsset: ProductAsset;
  receivedSymbol?: string;
  /** Opaque UA transaction payload retained for later execute (not returned). */
  transactionId: string;
  rawTransaction: unknown;
  providerExpiresAt: string | null;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
  gateReport?: GateCheck[];
  gateVersion?: string;
  targetFingerprint?: string;
  gateExpiresAt?: string;
  eligibleForExecution: boolean;
};

export type AgentTradeQuoteResponse = {
  ok: true;
  quoteId: string;
  action: "trade";
  intentFingerprint: string;
  issuedAt: string;
  serverTime: string;
  expiresAt: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  destChain: DestChain;
  toAsset: ProductAsset;
  receivedSymbol?: string;
  sizeUsd: number;
  publicationIntent: boolean;
  eligibleForExecution: boolean;
  gateReport?: GateCheck[];
  gateVersion?: string;
  targetFingerprint?: string;
};

export type QuoteFieldError = {
  field: string;
  code: string;
  message: string;
};

export type AgentQuoteErrorCode =
  | "invalid_input"
  | "unsupported_asset"
  | "arbitrary_token_rejected"
  | "lifecycle_blocked"
  | "gate_failed"
  | "quote_expired"
  | "quote_not_found"
  | "quote_mismatch"
  | "unavailable";

export class AgentQuoteError extends Error {
  constructor(
    public readonly code: AgentQuoteErrorCode,
    message: string,
    public readonly details: {
      fields?: QuoteFieldError[];
      gateReport?: GateCheck[];
      preview?: {
        dollarsIn: number;
        dollarsOut: number;
        feeUsd: number;
        floorUsd: number;
        sourceChain: string;
        destChain: DestChain;
      };
    } = {},
  ) {
    super(message);
    this.name = "AgentQuoteError";
  }
}

export function quoteErrorStatus(code: AgentQuoteErrorCode): number {
  switch (code) {
    case "quote_not_found":
      return 404;
    case "lifecycle_blocked":
    case "quote_expired":
    case "quote_mismatch":
    case "gate_failed":
      return 409;
    case "invalid_input":
    case "unsupported_asset":
    case "arbitrary_token_rejected":
      return 422;
    case "unavailable":
      return 503;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export type AgentQuoteStore = {
  save(record: AgentTradeQuoteRecord): Promise<AgentTradeQuoteRecord>;
  get(quoteId: string): Promise<AgentTradeQuoteRecord | null>;
};

export class MemoryAgentQuoteStore implements AgentQuoteStore {
  private readonly records = new Map<string, AgentTradeQuoteRecord>();

  async save(record: AgentTradeQuoteRecord): Promise<AgentTradeQuoteRecord> {
    const frozen = Object.freeze({ ...record });
    this.records.set(record.quoteId, frozen);
    return frozen;
  }

  async get(quoteId: string): Promise<AgentTradeQuoteRecord | null> {
    return this.records.get(quoteId) ?? null;
  }

  /** Test helper. */
  clear(): void {
    this.records.clear();
  }
}

const FORBIDDEN_INPUT_KEYS = [
  "token",
  "address",
  "contract",
  "contractAddress",
  "tokenAddress",
  "tokenRef",
  "chainId",
  "side",
  "asset",
  "dollarsIn",
  "publish",
  "text",
  "prompt",
  "instruction",
  "naturalLanguage",
] as const;

function isMcpTradeAsset(value: unknown): value is McpTradeAsset {
  return (
    typeof value === "string" &&
    (MCP_TRADE_ASSETS as readonly string[]).includes(value)
  );
}

/** Stable JSON for fingerprinting — sorted keys, no whitespace variance. */
export function canonicalJson(value: unknown): string {
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

export function hashFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * Effective quote expiry: min(providerExpiresAt, issuedAt + 60s).
 * Missing provider expiry → configured default ≤ 60s (ADR 0041).
 */
export function computeQuoteExpiresAt(input: {
  issuedAt: Date;
  providerExpiresAt?: Date | null;
  defaultTtlMs?: number;
  maxTtlMs?: number;
}): Date {
  const maxTtlMs = input.maxTtlMs ?? QUOTE_MAX_TTL_MS;
  const defaultTtlMs = Math.min(
    input.defaultTtlMs ?? QUOTE_DEFAULT_TTL_MS,
    maxTtlMs,
  );
  const cap = new Date(input.issuedAt.getTime() + maxTtlMs);
  const fallback = new Date(input.issuedAt.getTime() + defaultTtlMs);
  if (!input.providerExpiresAt) return fallback.getTime() < cap.getTime() ? fallback : cap;
  const provider = input.providerExpiresAt;
  return provider.getTime() < cap.getTime() ? provider : cap;
}

/**
 * Parse and validate structured MCP trade fields.
 * Never calls parseIntentHeuristic / LLM parsers.
 */
export function parseStructuredTradeQuoteInput(
  body: Record<string, unknown>,
): StructuredTradeQuoteInput {
  const forbidden = FORBIDDEN_INPUT_KEYS.filter((key) => key in body);
  if (forbidden.length > 0) {
    throw new AgentQuoteError(
      "arbitrary_token_rejected",
      "Direct MCP trades accept named product assets only. Contract addresses and TokenRef fields are rejected.",
      {
        fields: forbidden.map((field) => ({
          field,
          code: "forbidden_field",
          message: `Remove "${field}". Use a named product asset (cash, eth, usdc, …) instead.`,
        })),
      },
    );
  }

  const fields: QuoteFieldError[] = [];

  if (!("toAsset" in body)) {
    fields.push({
      field: "toAsset",
      code: "required",
      message: "Provide toAsset as a named product asset (e.g. \"eth\" or \"cash\").",
    });
  } else if (!isMcpTradeAsset(body.toAsset)) {
    if (body.toAsset === "token" || isProductAsset(body.toAsset)) {
      throw new AgentQuoteError(
        "arbitrary_token_rejected",
        "Direct MCP trades cannot target arbitrary tokens. Use a named product asset, or back a published conviction.",
        {
          fields: [
            {
              field: "toAsset",
              code: "unsupported_asset",
              message:
                'toAsset "token" is not allowed on conviction_quote_trade. Back a canonical conviction instead.',
            },
          ],
        },
      );
    }
    throw new AgentQuoteError(
      "unsupported_asset",
      "That destination asset is not supported for direct MCP trades.",
      {
        fields: [
          {
            field: "toAsset",
            code: "unsupported_asset",
            message: `Supported assets: ${MCP_TRADE_ASSETS.join(", ")}.`,
          },
        ],
      },
    );
  }

  let fromAsset: McpTradeAsset | undefined;
  if ("fromAsset" in body && body.fromAsset !== undefined) {
    if (!isMcpTradeAsset(body.fromAsset)) {
      throw new AgentQuoteError(
        "unsupported_asset",
        "That source asset is not supported for direct MCP trades.",
        {
          fields: [
            {
              field: "fromAsset",
              code: "unsupported_asset",
              message: `Supported assets: ${MCP_TRADE_ASSETS.join(", ")}.`,
            },
          ],
        },
      );
    }
    fromAsset = body.fromAsset;
  }

  const hasSize = body.sizeUsd !== undefined && body.sizeUsd !== null;
  const hasFraction = body.fraction !== undefined && body.fraction !== null;
  if (hasSize === hasFraction) {
    fields.push({
      field: hasSize ? "sizeUsd" : "sizeUsd|fraction",
      code: "size_required",
      message:
        "Provide exactly one of sizeUsd (positive dollars) or fraction (0–1 of balance).",
    });
  }

  let sizeUsd: number | undefined;
  if (hasSize) {
    if (typeof body.sizeUsd !== "number" || !Number.isFinite(body.sizeUsd)) {
      fields.push({
        field: "sizeUsd",
        code: "invalid_type",
        message: "sizeUsd must be a finite positive number.",
      });
    } else if (body.sizeUsd <= 0) {
      fields.push({
        field: "sizeUsd",
        code: "invalid_value",
        message: "sizeUsd must be greater than zero.",
      });
    } else {
      sizeUsd = body.sizeUsd;
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

  let destChain: DestChain | undefined;
  if ("destChain" in body && body.destChain !== undefined) {
    if (!isDestChain(body.destChain)) {
      fields.push({
        field: "destChain",
        code: "unsupported_chain",
        message: 'destChain must be "Arbitrum" or "Base".',
      });
    } else {
      destChain = body.destChain;
    }
  }

  let publicationIntent = false;
  if ("publicationIntent" in body && body.publicationIntent !== undefined) {
    if (typeof body.publicationIntent !== "boolean") {
      fields.push({
        field: "publicationIntent",
        code: "invalid_type",
        message: "publicationIntent must be a boolean.",
      });
    } else {
      publicationIntent = body.publicationIntent;
    }
  }

  if (fields.length > 0) {
    throw new AgentQuoteError(
      "invalid_input",
      "Structured trade fields failed validation. Fix the listed fields and retry.",
      { fields },
    );
  }

  return {
    toAsset: body.toAsset as McpTradeAsset,
    ...(fromAsset ? { fromAsset } : {}),
    ...(sizeUsd != null ? { sizeUsd } : {}),
    ...(fraction != null ? { fraction } : {}),
    ...(destChain ? { destChain } : {}),
    publicationIntent,
  };
}

/**
 * Research-mode validation for quotes: asset/size rules without requiring
 * spendable balance (ADR 0039). Does not call the NL parser.
 */
export function validateStructuredTradeForQuote(
  input: StructuredTradeQuoteInput,
  balance: UniversalBalance,
): { intent: TradeIntent; sizeUsd: number } {
  const toAsset = input.toAsset;
  const fromAsset = input.fromAsset;

  if (fromAsset && isBuyOnlyAsset(fromAsset)) {
    throw new AgentQuoteError(
      "invalid_input",
      `${fromAsset.toUpperCase()} can only be bought for now, not sold.`,
      {
        fields: [
          {
            field: "fromAsset",
            code: "buy_only",
            message: `${fromAsset.toUpperCase()} cannot fund a trade.`,
          },
        ],
      },
    );
  }

  if (fromAsset && isBuyOnlyAsset(toAsset)) {
    throw new AgentQuoteError(
      "invalid_input",
      `Buy ${toAsset.toUpperCase()} with cash instead — converting another asset into it isn't supported yet.`,
      {
        fields: [
          {
            field: "fromAsset",
            code: "invalid_pair",
            message: `Omit fromAsset or use cash when buying ${toAsset.toUpperCase()}.`,
          },
        ],
      },
    );
  }

  const destChain =
    input.destChain ??
    (balance.totalUsd > 0
      ? pickSettlementChain(toAsset, balance)
      : DEFAULT_DEST_CHAIN);

  if (!tokenAddress(toUaTokenType(toAsset), destChainId(destChain))) {
    throw new AgentQuoteError(
      "unsupported_asset",
      "That destination isn't supported on the chosen settlement chain yet.",
      {
        fields: [
          {
            field: "toAsset",
            code: "unsupported_on_chain",
            message: `${toAsset} cannot settle on ${destChain} yet.`,
          },
        ],
      },
    );
  }

  let sizeUsd: number;
  if (input.sizeUsd != null) {
    sizeUsd = input.sizeUsd;
  } else if (input.fraction != null) {
    if (balance.totalUsd <= 0) {
      throw new AgentQuoteError(
        "invalid_input",
        "fraction requires a spendable balance. Pass sizeUsd while the account is unfunded.",
        {
          fields: [
            {
              field: "fraction",
              code: "requires_balance",
              message: "Use sizeUsd for research quotes on an unfunded account.",
            },
          ],
        },
      );
    }
    const base =
      fromAsset != null
        ? balance.sources
            .filter((s) => assetMatches(s.asset, fromAsset))
            .reduce((acc, s) => acc + s.usd, 0)
        : balance.totalUsd;
    sizeUsd = base * input.fraction;
    if (sizeUsd <= 0) {
      throw new AgentQuoteError(
        "invalid_input",
        "fraction resolved to zero against the current balance.",
        {
          fields: [
            {
              field: "fraction",
              code: "resolved_zero",
              message: "Choose a larger fraction or pass sizeUsd.",
            },
          ],
        },
      );
    }
  } else {
    throw new AgentQuoteError(
      "invalid_input",
      "Provide exactly one of sizeUsd or fraction.",
    );
  }

  const intent: TradeIntent = {
    toAsset,
    destChain,
    sizeUsd,
    ...(fromAsset ? { fromAsset } : {}),
  };

  return { intent, sizeUsd };
}

export function buildIntentFingerprint(input: {
  action: "trade";
  intent: TradeIntent;
  sizeUsd: number;
  publicationIntent: boolean;
}): string {
  return hashFingerprint({
    action: input.action,
    fromAsset: input.intent.fromAsset ?? null,
    toAsset: input.intent.toAsset,
    sizeUsd: input.sizeUsd,
    destChain: input.intent.destChain,
    publicationIntent: input.publicationIntent,
  });
}

export function buildQuoteTermsFingerprint(input: {
  intentFingerprint: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  destChain: DestChain;
}): string {
  return hashFingerprint(input);
}

function assertQuoteEligibleLifecycle(agent: OwnedAgent): void {
  if (
    agent.status === "retired" ||
    agent.status === "retiring" ||
    agent.status === "provisioning"
  ) {
    throw new AgentQuoteError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and cannot request trade quotes.`,
    );
  }
}

/** Product-primary tokens skip external long-tail gate probes (native ETH). */
function isNativeProductAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

/**
 * Run the publication gate for a named product target (ADR 0033).
 * Injectable router keeps CI offline (ADR 0014).
 */
export async function runPublicationGateForProduct(input: {
  toAsset: ProductAsset;
  destChain: DestChain;
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  fetchImpl?: typeof fetch;
}): Promise<{
  gateReport: GateCheck[];
  targetFingerprint: string;
  targetAddress: string;
}> {
  const address = tokenAddress(
    toUaTokenType(input.toAsset),
    destChainId(input.destChain),
  );
  if (!address) {
    throw new AgentQuoteError(
      "unsupported_asset",
      "Cannot gate a product asset without a known settlement address.",
    );
  }

  const targetFingerprint = hashFingerprint({
    toAsset: input.toAsset,
    destChain: input.destChain,
    address: address.toLowerCase(),
  });

  if (isNativeProductAddress(address)) {
    // Native ETH has no ERC-20 pool page; treat supported primaries as gated.
    const gateReport: GateCheck[] = [
      {
        id: "liquidity",
        name: "Liquidity depth",
        passed: true,
        detail: "Named product primary on a supported settlement chain.",
      },
      {
        id: "contract",
        name: "Contract verification",
        passed: true,
        detail: "Native product asset — no long-tail contract surface.",
      },
      {
        id: "routability",
        name: "UA routability",
        passed: true,
        detail: "Named product primary is routable through Universal Account.",
      },
    ];
    return { gateReport, targetFingerprint, targetAddress: address };
  }

  const gateReport = await runGateCheck(address, input.destChain, {
    checkRouter: input.checkRouter,
    ...(input.fetchImpl ? { fetch: input.fetchImpl } : {}),
  });
  return { gateReport, targetFingerprint, targetAddress: address };
}

export type IssueTradeQuoteOptions = {
  store: AgentQuoteStore;
  ua: UAClient;
  agent: OwnedAgent;
  body: Record<string, unknown>;
  now?: () => Date;
  randomId?: () => string;
  providerExpiresAt?: Date | null;
  checkRouter?: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
  fetchImpl?: typeof fetch;
  /** Optional balance override (tests / injected research balance). */
  balance?: UniversalBalance;
};

/**
 * Issue a short-lived structured trade quote.
 * Moves no funds, reserves no spend, and remains available when trade is
 * disabled or the account is unfunded.
 */
export async function issueTradeQuote(
  options: IssueTradeQuoteOptions,
): Promise<AgentTradeQuoteResponse> {
  assertQuoteEligibleLifecycle(options.agent);

  const parsed = parseStructuredTradeQuoteInput(options.body);
  const balance =
    options.balance ?? (await options.ua.getUniversalBalance());
  const { intent, sizeUsd } = validateStructuredTradeForQuote(parsed, balance);

  const tradeQuote: TradeQuote = await options.ua.quoteTrade({
    intent,
    sizeUsd,
  });

  const now = options.now?.() ?? new Date();
  const issuedAt = now.toISOString();
  const providerExpiresAt = options.providerExpiresAt ?? null;
  const expiresAt = computeQuoteExpiresAt({
    issuedAt: now,
    providerExpiresAt,
  }).toISOString();

  const publicationIntent = parsed.publicationIntent === true;
  const intentFingerprint = buildIntentFingerprint({
    action: "trade",
    intent,
    sizeUsd,
    publicationIntent,
  });

  let gateReport: GateCheck[] | undefined;
  let gateVersion: string | undefined;
  let targetFingerprint: string | undefined;
  let gateExpiresAt: string | undefined;
  const eligibleForExecution = true;

  if (publicationIntent) {
    const checkRouter =
      options.checkRouter ??
      (async (): Promise<WarmUpRouteResult> => ({ status: "routable" }));
    const gated = await runPublicationGateForProduct({
      toAsset: intent.toAsset,
      destChain: intent.destChain!,
      checkRouter,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    gateReport = gated.gateReport;
    gateVersion = PUBLICATION_GATE_VERSION;
    targetFingerprint = gated.targetFingerprint;
    gateExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const failed = failedCheckName(gateReport);
    if (failed) {
      throw new AgentQuoteError(
        "gate_failed",
        `Publication gate failed: ${failed}. No funds moved and no spend was reserved.`,
        {
          gateReport,
          preview: {
            dollarsIn: tradeQuote.dollarsIn,
            dollarsOut: tradeQuote.dollarsOut,
            feeUsd: tradeQuote.feeUsd,
            floorUsd: tradeQuote.floorUsd,
            sourceChain: tradeQuote.sourceChain,
            destChain: tradeQuote.destChain,
          },
        },
      );
    }
  }

  // Terms fingerprint binds quote economics so execute cannot swap changed terms.
  const termsFingerprint = buildQuoteTermsFingerprint({
    intentFingerprint,
    dollarsIn: tradeQuote.dollarsIn,
    dollarsOut: tradeQuote.dollarsOut,
    feeUsd: tradeQuote.feeUsd,
    floorUsd: tradeQuote.floorUsd,
    sourceChain: tradeQuote.sourceChain,
    destChain: tradeQuote.destChain,
  });

  const quoteId = options.randomId?.() ?? randomUUID();
  const record: AgentTradeQuoteRecord = {
    quoteId,
    agentId: options.agent.agentId,
    action: "trade",
    intentFingerprint: termsFingerprint,
    intent,
    sizeUsd,
    publicationIntent,
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
    eligibleForExecution,
    ...(gateReport ? { gateReport } : {}),
    ...(gateVersion ? { gateVersion } : {}),
    ...(targetFingerprint ? { targetFingerprint } : {}),
    ...(gateExpiresAt ? { gateExpiresAt } : {}),
  };

  await options.store.save(record);

  return {
    ok: true,
    quoteId: record.quoteId,
    action: "trade",
    intentFingerprint: record.intentFingerprint,
    issuedAt: record.issuedAt,
    serverTime: issuedAt,
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
    publicationIntent: record.publicationIntent,
    eligibleForExecution: record.eligibleForExecution,
    ...(record.gateReport ? { gateReport: record.gateReport } : {}),
    ...(record.gateVersion ? { gateVersion: record.gateVersion } : {}),
    ...(record.targetFingerprint
      ? { targetFingerprint: record.targetFingerprint }
      : {}),
  };
}

/** Lookup helper for later execute (#55) — enforces expiry and fingerprint. */
export async function getExecutableTradeQuote(
  store: AgentQuoteStore,
  input: {
    quoteId: string;
    agentId: string;
    intentFingerprint: string;
    now?: () => Date;
  },
): Promise<AgentTradeQuoteRecord> {
  const record = await store.get(input.quoteId);
  if (!record || record.agentId !== input.agentId) {
    throw new AgentQuoteError(
      "quote_not_found",
      "No trade quote matches that quoteId for this agent.",
    );
  }
  const now = input.now?.() ?? new Date();
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    throw new AgentQuoteError(
      "quote_expired",
      `Quote ${record.quoteId} expired at ${record.expiresAt}. Call conviction_quote_trade again for a fresh quoteId.`,
    );
  }
  if (record.intentFingerprint !== input.intentFingerprint) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "The quote fingerprint does not match the stored terms. Request a new quote.",
    );
  }
  if (!record.eligibleForExecution || record.used) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "That quote is not eligible for execution.",
    );
  }
  if (record.publicationIntent && !record.gateReport) {
    throw new AgentQuoteError(
      "quote_mismatch",
      "Publication-intent quote is missing its bound gate result.",
    );
  }
  return record;
}
