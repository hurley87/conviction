// postConviction verb — build feed entries from a completed trade (issue #4).
// Desk cards (issue #27) publish full anatomy through the same verb layer.

import { SETTLEMENT_CHAINS } from "@/lib/verbs/chains";
import type {
  ConvictionEntry,
  ConvictionTrade,
  DestChain,
  GateCheck,
  ProductAsset,
  Receipt,
  TokenRef,
  TradeIntent,
  TradeQuote,
  WhyNowEvent,
} from "@/lib/verbs/types";
import { isProductAsset } from "@/lib/verbs/assets";

export type BuildConvictionInput = {
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  receiptSlug?: string;
  whyNow?: WhyNowEvent[];
  whatBreaksIt?: string;
  gateReport?: GateCheck[];
};

/** Full-anatomy desk card — trade first, then author, then post (ADR 0016). */
export type BuildDeskCardInput = {
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  /** Entry receipt slug — must exist; entry time precedes publication. */
  receiptSlug: string;
  /** Onchain entry timestamp (receipt created_at), ISO string. */
  entryAt: string;
  whyNow: WhyNowEvent[];
  whatBreaksIt: string;
  /** Gate-check output passed in — not re-run here. */
  gateReport: GateCheck[];
  /** Override publication time (tests); defaults to now. */
  publishedAt?: string;
};

/** Generate a short unique id for a conviction feed entry. */
export function generateConvictionEntryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Assemble a conviction entry with denormalized handle (ADR 0009). */
export function buildConviction({
  handle,
  thesis,
  trade,
  receiptSlug,
  whyNow,
  whatBreaksIt,
  gateReport,
}: BuildConvictionInput): ConvictionEntry {
  return {
    entryId: generateConvictionEntryId(),
    handle,
    thesis: thesis.trim(),
    trade,
    createdAt: new Date().toISOString(),
    backedBy: [],
    ...(receiptSlug ? { receiptSlug } : {}),
    ...(whyNow && whyNow.length > 0 ? { whyNow } : {}),
    ...(whatBreaksIt ? { whatBreaksIt } : {}),
    ...(gateReport && gateReport.length > 0 ? { gateReport } : {}),
  };
}

/** Map a completed trade into conviction trade metadata. */
export function tradeToConvictionTrade(
  intent: TradeIntent,
  quote: TradeQuote,
  sizeUsd: number,
  receipt?: Receipt | null,
): ConvictionTrade {
  const fromChain =
    receipt?.legs[0]?.chain ?? quote.sourceChain ?? "Unknown";
  const fromAsset = intent.fromAsset ?? inferFromAsset(intent.toAsset);

  if (!intent.destChain) {
    throw new Error("Settlement chain required before publishing a conviction.");
  }

  return {
    fromAsset,
    fromChain,
    toAsset: intent.toAsset,
    ...(intent.token ? { token: intent.token } : {}),
    toChain: intent.destChain,
    sizeUsd,
  };
}

/** When the user didn't specify a source asset, infer a plausible opposite. */
function inferFromAsset(toAsset: ProductAsset): ProductAsset {
  if (toAsset === "cash") return "eth";
  return "cash";
}

/** Append a backer's handle to backedBy, deduping. */
export function appendBacker(backedBy: string[], handle: string): string[] {
  const trimmed = handle.trim();
  if (!trimmed || backedBy.includes(trimmed)) return backedBy;
  return [...backedBy, trimmed];
}

function isDestChain(value: unknown): value is DestChain {
  return (
    typeof value === "string" &&
    (SETTLEMENT_CHAINS as readonly string[]).includes(value)
  );
}

/** Validate an optional TokenRef so backs re-target the exact token. */
export function parseTokenRef(value: unknown): TokenRef | null {
  if (!value || typeof value !== "object") return null;
  const t = value as Record<string, unknown>;
  if (typeof t.chainId !== "number" || !Number.isFinite(t.chainId)) return null;
  if (typeof t.address !== "string" || !t.address.trim()) return null;
  if (typeof t.symbol !== "string" || !t.symbol.trim()) return null;
  return {
    chainId: t.chainId,
    address: t.address.trim(),
    symbol: t.symbol.trim(),
  };
}

/** Validate a conviction trade payload from the API. */
export function parseConvictionTrade(
  trade: unknown,
): ConvictionTrade | null {
  if (!trade || typeof trade !== "object") return null;
  const t = trade as Record<string, unknown>;
  if (
    !isProductAsset(t.fromAsset) ||
    !isProductAsset(t.toAsset) ||
    typeof t.fromChain !== "string" ||
    !isDestChain(t.toChain) ||
    typeof t.sizeUsd !== "number" ||
    t.sizeUsd <= 0
  ) {
    return null;
  }

  let token: TokenRef | undefined;
  if (t.token !== undefined && t.token !== null) {
    const parsed = parseTokenRef(t.token);
    if (!parsed) return null;
    // Concrete tokens use the "token" sentinel (same as TradeIntent).
    if (t.toAsset !== "token") return null;
    token = parsed;
  } else if (t.toAsset === "token") {
    // Sentinel without a TokenRef is invalid.
    return null;
  }

  return {
    fromAsset: t.fromAsset,
    fromChain: t.fromChain,
    toAsset: t.toAsset,
    ...(token ? { token } : {}),
    toChain: t.toChain,
    sizeUsd: t.sizeUsd,
  };
}

/**
 * Entry timestamp must precede (or equal) card publication — every published
 * card is a revealed position with its entry already onchain (issue #27).
 */
export function entryPrecedesPublication(
  entryAt: string,
  publishedAt: string,
): boolean {
  const entryMs = Date.parse(entryAt);
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(entryMs) || !Number.isFinite(publishedMs)) return false;
  return entryMs <= publishedMs;
}

/**
 * Assemble a desk card with full anatomy + linked entry receipt.
 * Throws when entry time does not precede publication.
 */
export function buildDeskCard(input: BuildDeskCardInput): ConvictionEntry {
  const publishedAt = input.publishedAt ?? new Date().toISOString();
  if (!entryPrecedesPublication(input.entryAt, publishedAt)) {
    throw new Error(
      "Entry receipt timestamp must precede card publication time.",
    );
  }
  if (!input.receiptSlug.trim()) {
    throw new Error("Desk cards require a linked entry receipt.");
  }
  if (!input.whyNow.length) {
    throw new Error("Desk cards require a why-now timeline.");
  }
  if (!input.whatBreaksIt.trim()) {
    throw new Error("Desk cards require a what-breaks-it falsifier.");
  }
  if (!input.gateReport.length) {
    throw new Error("Desk cards require a gate report.");
  }

  const entry = buildConviction({
    handle: input.handle,
    thesis: input.thesis,
    trade: input.trade,
    receiptSlug: input.receiptSlug.trim(),
    whyNow: input.whyNow,
    whatBreaksIt: input.whatBreaksIt,
    gateReport: input.gateReport,
  });
  entry.createdAt = publishedAt;
  return entry;
}

/**
 * Parse an optional array field. `undefined` when absent or empty;
 * `null` when present but not an array, or containing an invalid item.
 */
function parseOptionalArray<T>(
  value: unknown,
  parseItem: (item: unknown) => T | null,
): T[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

function parseWhyNowEvent(item: unknown): WhyNowEvent | null {
  if (!item || typeof item !== "object") return null;
  const e = item as Record<string, unknown>;
  if (typeof e.at !== "string" || !e.at.trim()) return null;
  if (typeof e.event !== "string" || !e.event.trim()) return null;
  return { at: e.at.trim(), event: e.event.trim() };
}

/**
 * Parse optional why-now timeline. `undefined` when absent;
 * `null` when present but invalid.
 */
export function parseWhyNow(value: unknown): WhyNowEvent[] | undefined | null {
  return parseOptionalArray(value, parseWhyNowEvent);
}

/**
 * Parse optional falsifier. `undefined` when absent;
 * `null` when present but invalid.
 */
export function parseWhatBreaksIt(
  value: unknown,
): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseGateCheck(item: unknown): GateCheck | null {
  if (!item || typeof item !== "object") return null;
  const c = item as Record<string, unknown>;
  if (typeof c.name !== "string" || !c.name.trim()) return null;
  if (typeof c.passed !== "boolean") return null;
  if (
    c.evidenceUrl !== undefined &&
    c.evidenceUrl !== null &&
    typeof c.evidenceUrl !== "string"
  ) {
    return null;
  }
  const check: GateCheck = { name: c.name.trim(), passed: c.passed };
  if (typeof c.evidenceUrl === "string" && c.evidenceUrl.trim()) {
    check.evidenceUrl = c.evidenceUrl.trim();
  }
  return check;
}

/**
 * Parse optional gate report. `undefined` when absent;
 * `null` when present but invalid.
 */
export function parseGateReport(
  value: unknown,
): GateCheck[] | undefined | null {
  return parseOptionalArray(value, parseGateCheck);
}

/** True when the entry carries any optional card anatomy. */
export function hasAnatomy(entry: ConvictionEntry): boolean {
  return Boolean(
    (entry.whyNow && entry.whyNow.length > 0) ||
      entry.whatBreaksIt ||
      (entry.gateReport && entry.gateReport.length > 0),
  );
}
