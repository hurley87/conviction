// postConviction verb — build feed entries from a completed trade (issue #4).

import type {
  ConvictionEntry,
  ConvictionTrade,
  GateCheck,
  ProductAsset,
  Receipt,
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
    typeof t.toChain !== "string" ||
    typeof t.sizeUsd !== "number" ||
    t.sizeUsd <= 0
  ) {
    return null;
  }
  return {
    fromAsset: t.fromAsset,
    fromChain: t.fromChain,
    toAsset: t.toAsset,
    toChain: t.toChain as ConvictionTrade["toChain"],
    sizeUsd: t.sizeUsd,
  };
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
