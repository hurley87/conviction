// summarizeFeed verb — read-only digest + flagged entries (issue #6).
// Pure functions over ConvictionEntry[]; safe to import client-side for
// classification. Flags are deterministic; LLM only refines prose server-side.

import type { ConvictionEntry } from "@/lib/verbs/types";

/** Minimum word count for a thesis to avoid "thin rationale" flag. */
export const MIN_THESIS_WORDS = 4;

/** Minimum character count for a thesis to avoid "thin rationale" flag. */
export const MIN_THESIS_CHARS = 24;

/** Size must exceed median × this multiple to flag as unusually large. */
export const RISK_MULTIPLE = 3;

/** Absolute floor (USD) — ignore risk flag below this even if above median. */
export const RISK_ABSOLUTE_FLOOR_USD = 50;

export type FlaggedConviction = {
  entryId: string;
  handle: string;
  reason: string;
};

export type FeedSummary = {
  digest: string;
  /** Canonical PRD field — entryIds only. */
  flagged: string[];
  flaggedEntries: FlaggedConviction[];
};

const FEED_REFERENCE =
  /\b(?:feed|convictions?|calls?|posts?|timeline|what(?:'s| is) (?:new|on|happening))\b/i;

const SUMMARY_INTENT =
  /\b(?:summari[sz]e|sanity[- ]?check|recap|digest|overview|review|check|read|scan|what(?:'s| is) (?:new|on|happening)|give me (?:a )?(?:summary|recap|overview))\b/i;

/** Bare "summarize" / "recap" / "digest", with the feed implied. */
const BARE_SUMMARY = /^(?:summari[sz]e|recap|digest)(?:\s+(?:the|this))?\s*$/i;

/**
 * Deterministic classifier: does this message ask for a feed summary rather
 * than a trade? Offline-safe — used client-side before routing submitText.
 */
export function isFeedSummaryRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // A summary intent alongside a feed reference, in either order — covers
  // "summarize the feed", "sanity-check the convictions", "what's on the feed".
  if (FEED_REFERENCE.test(trimmed) && SUMMARY_INTENT.test(trimmed)) {
    return true;
  }

  // Bare "summarize" / "recap" with feed context implied.
  return BARE_SUMMARY.test(trimmed);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function medianSizeUsd(entries: ConvictionEntry[]): number {
  if (entries.length === 0) return 0;
  const sizes = entries.map((e) => e.trade.sizeUsd).sort((a, b) => a - b);
  const mid = Math.floor(sizes.length / 2);
  if (sizes.length % 2 === 0) {
    return (sizes[mid - 1]! + sizes[mid]!) / 2;
  }
  return sizes[mid]!;
}

function isThinThesis(thesis: string): boolean {
  const trimmed = thesis.trim();
  return (
    wordCount(trimmed) < MIN_THESIS_WORDS ||
    trimmed.length < MIN_THESIS_CHARS
  );
}

function isUnusuallyLarge(
  sizeUsd: number,
  median: number,
): boolean {
  if (sizeUsd < RISK_ABSOLUTE_FLOOR_USD) return false;
  if (median <= 0) return sizeUsd >= RISK_ABSOLUTE_FLOOR_USD;
  return sizeUsd > RISK_MULTIPLE * median;
}

/**
 * Flag entries with thin rationale or unusually large size (feed data only).
 */
export function flagConvictions(
  entries: ConvictionEntry[],
): FlaggedConviction[] {
  const median = medianSizeUsd(entries);
  const flagged: FlaggedConviction[] = [];

  for (const entry of entries) {
    const reasons: string[] = [];
    if (isThinThesis(entry.thesis)) {
      reasons.push("thin rationale");
    }
    if (isUnusuallyLarge(entry.trade.sizeUsd, median)) {
      reasons.push("much larger than typical");
    }
    if (reasons.length > 0) {
      flagged.push({
        entryId: entry.entryId,
        handle: entry.handle,
        reason: reasons.join("; "),
      });
    }
  }

  return flagged;
}

function formatAssetLabel(asset: string): string {
  if (asset === "cash") return "cash";
  return asset.toUpperCase();
}

function dominantTarget(entries: ConvictionEntry[]): string | null {
  if (entries.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of entries) {
    const label = formatAssetLabel(e.trade.toAsset);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Deterministic plain-English digest (CI-safe fallback and LLM base).
 */
export function buildDigest(
  entries: ConvictionEntry[],
  flagged: FlaggedConviction[],
): string {
  if (entries.length === 0) {
    return "The feed is empty right now — no convictions to summarize.";
  }

  const handles = new Set(entries.map((e) => e.handle));
  const traderCount = handles.size;
  const dominant = dominantTarget(entries);

  let digest = `${entries.length} conviction${entries.length === 1 ? "" : "s"} from ${traderCount} trader${traderCount === 1 ? "" : "s"}.`;

  if (dominant) {
    digest += ` Most calls are moving into ${dominant}.`;
  }

  const recent = entries.slice(0, 3);
  const highlights = recent
    .map((e) => `@${e.handle} → ${formatAssetLabel(e.trade.toAsset)}`)
    .join("; ");
  digest += ` Recent: ${highlights}.`;

  if (flagged.length === 0) {
    digest += " Nothing stood out as unusually risky or low-context.";
  } else {
    const flagList = flagged
      .map((f) => `@${f.handle} (${f.reason})`)
      .join("; ");
    digest += ` ${flagged.length} flagged for a closer look: ${flagList}.`;
  }

  return digest;
}

/** Compose flags + deterministic digest from feed entries. */
export function summarizeFeedFromEntries(
  entries: ConvictionEntry[],
): FeedSummary {
  const flaggedEntries = flagConvictions(entries);
  const digest = buildDigest(entries, flaggedEntries);
  return {
    digest,
    flagged: flaggedEntries.map((f) => f.entryId),
    flaggedEntries,
  };
}
