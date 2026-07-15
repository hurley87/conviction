// postConviction verb — build feed entries from a completed trade (issue #4).
// Desk cards (issue #27) publish full anatomy through the same verb layer.

import { isDestChain } from "@/lib/verbs/chains";
import type {
  ConvictionEntry,
  ConvictionTrade,
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
  /** Override publication time (desk cards / tests). Defaults to now. */
  createdAt?: string;
};

/**
 * Desk card fields after parse — entryAt comes from the receipt store on live
 * publish, or from the JSON file on DESK_DRY_RUN.
 */
export type DeskCardFields = {
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  receiptSlug: string;
  whyNow: WhyNowEvent[];
  whatBreaksIt: string;
  gateReport: GateCheck[];
  entryAt?: string;
  publishedAt?: string;
};

/** Full-anatomy desk card — trade first, then author, then post (ADR 0016). */
export type BuildDeskCardInput = {
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  receiptSlug: string;
  entryAt: string;
  whyNow: WhyNowEvent[];
  whatBreaksIt: string;
  gateReport: GateCheck[];
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
  createdAt,
}: BuildConvictionInput): ConvictionEntry {
  return {
    entryId: generateConvictionEntryId(),
    handle,
    thesis: thesis.trim(),
    trade,
    createdAt: createdAt ?? new Date().toISOString(),
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
 * True when the payload is aiming at a desk / TokenRef card — must then
 * satisfy the full `buildDeskCard` contract (no partial anatomy).
 */
export function isDeskCardIntent(input: {
  trade: ConvictionTrade;
  whyNow?: WhyNowEvent[];
  whatBreaksIt?: string;
  gateReport?: GateCheck[];
}): boolean {
  return Boolean(
    input.trade.token ||
      (input.whyNow && input.whyNow.length > 0) ||
      input.whatBreaksIt ||
      (input.gateReport && input.gateReport.length > 0),
  );
}

/**
 * Parse a desk-card JSON body into typed fields. Shared by the CLI and API
 * so there is one validation boundary for full-anatomy posts.
 */
export function parseDeskCardFields(
  raw: unknown,
): { ok: true; value: DeskCardFields } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid JSON payload" };
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return { ok: false, error: "handle required" };
  }
  if (typeof body.thesis !== "string" || !body.thesis.trim()) {
    return { ok: false, error: "thesis required" };
  }
  if (typeof body.receiptSlug !== "string" || !body.receiptSlug.trim()) {
    return { ok: false, error: "receiptSlug required for desk cards" };
  }

  const trade = parseConvictionTrade(body.trade);
  if (!trade) {
    return { ok: false, error: "invalid trade payload" };
  }

  const whyNow = parseWhyNow(body.whyNow);
  if (whyNow === null) return { ok: false, error: "invalid whyNow payload" };
  if (!whyNow?.length) {
    return { ok: false, error: "whyNow required (non-empty) for desk cards" };
  }

  const whatBreaksIt = parseWhatBreaksIt(body.whatBreaksIt);
  if (whatBreaksIt === null) {
    return { ok: false, error: "invalid whatBreaksIt payload" };
  }
  if (!whatBreaksIt) {
    return { ok: false, error: "whatBreaksIt required for desk cards" };
  }

  const gateReport = parseGateReport(body.gateReport);
  if (gateReport === null) {
    return { ok: false, error: "invalid gateReport payload" };
  }
  if (!gateReport?.length) {
    return { ok: false, error: "gateReport required (non-empty) for desk cards" };
  }

  const entryAt =
    typeof body.entryAt === "string" && body.entryAt.trim()
      ? body.entryAt.trim()
      : undefined;
  const publishedAt =
    typeof body.publishedAt === "string" && body.publishedAt.trim()
      ? body.publishedAt.trim()
      : undefined;

  return {
    ok: true,
    value: {
      handle: body.handle.trim(),
      thesis: body.thesis,
      trade,
      receiptSlug: body.receiptSlug.trim(),
      whyNow,
      whatBreaksIt,
      gateReport,
      ...(entryAt ? { entryAt } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    },
  };
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

  return buildConviction({
    handle: input.handle,
    thesis: input.thesis,
    trade: input.trade,
    receiptSlug: input.receiptSlug.trim(),
    whyNow: input.whyNow,
    whatBreaksIt: input.whatBreaksIt,
    gateReport: input.gateReport,
    createdAt: publishedAt,
  });
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
