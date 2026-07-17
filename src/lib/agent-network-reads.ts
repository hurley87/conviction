// Compact, agent-facing read shapes for MCP network inspection (issue #53).
// Keeps list/get/summarize/receipt payloads small enough for host context windows.

import type { ConvictionEntry, Receipt } from "@/lib/verbs/types";

export const DEFAULT_CONVICTION_PAGE_LIMIT = 20;
export const MAX_CONVICTION_PAGE_LIMIT = 50;
export const COMPACT_THESIS_MAX_CHARS = 280;

export type CompactConvictionTrade = {
  fromAsset: string;
  toAsset: string;
  sizeUsd: number;
  toChain: string;
  tokenSymbol?: string;
};

export type CompactConvictionAnatomy = {
  whyNowCount: number;
  hasWhatBreaksIt: boolean;
  gatePassed: number;
  gateFailed: number;
};

/** Bounded list row — thesis truncated, anatomy summarized, backer count only. */
export type CompactConviction = {
  entryId: string;
  handle: string;
  thesis: string;
  trade: CompactConvictionTrade;
  createdAt: string;
  backerCount: number;
  receiptSlug?: string;
  anatomy: CompactConvictionAnatomy;
};

export type ConvictionAttribution = {
  backerCount: number;
  backedBy: string[];
};

export type ConvictionPage = {
  entries: CompactConviction[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type FeedSummaryResult = {
  digest: string;
  flagged: string[];
  flaggedEntries: Array<{
    entryId: string;
    handle: string;
    reason: string;
  }>;
};

export type ReceiptResult = {
  receiptId: string;
  receipt: Receipt;
  entryAt: string;
};

/** Truncate thesis for list rows without cutting mid-surrogate when possible. */
export function compactThesis(
  thesis: string,
  maxChars = COMPACT_THESIS_MAX_CHARS,
): string {
  const trimmed = thesis.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

export function toCompactConviction(entry: ConvictionEntry): CompactConviction {
  const gateReport = entry.gateReport ?? [];
  const trade: CompactConvictionTrade = {
    fromAsset: entry.trade.fromAsset,
    toAsset: entry.trade.toAsset,
    sizeUsd: entry.trade.sizeUsd,
    toChain: entry.trade.toChain,
    ...(entry.trade.token?.symbol
      ? { tokenSymbol: entry.trade.token.symbol }
      : {}),
  };

  return {
    entryId: entry.entryId,
    handle: entry.handle,
    thesis: compactThesis(entry.thesis),
    trade,
    createdAt: entry.createdAt,
    backerCount: entry.backedBy.length,
    ...(entry.receiptSlug ? { receiptSlug: entry.receiptSlug } : {}),
    anatomy: {
      whyNowCount: entry.whyNow?.length ?? 0,
      hasWhatBreaksIt: Boolean(entry.whatBreaksIt),
      gatePassed: gateReport.filter((check) => check.passed).length,
      gateFailed: gateReport.filter((check) => !check.passed).length,
    },
  };
}

export function toConvictionAttribution(
  entry: ConvictionEntry,
): ConvictionAttribution {
  return {
    backerCount: entry.backedBy.length,
    backedBy: [...entry.backedBy],
  };
}

/** Encode keyset cursor from the last row of a page. */
export function encodeConvictionCursor(entry: {
  createdAt: string;
  entryId: string;
}): string {
  return Buffer.from(
    `${entry.createdAt}\n${entry.entryId}`,
    "utf8",
  ).toString("base64url");
}

/** Decode a keyset cursor; returns null when the token is malformed. */
export function decodeConvictionCursor(
  cursor: string,
): { createdAt: string; entryId: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.indexOf("\n");
    if (separator <= 0 || separator === decoded.length - 1) return null;
    const createdAt = decoded.slice(0, separator);
    const entryId = decoded.slice(separator + 1);
    if (!createdAt || !entryId) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, entryId };
  } catch {
    return null;
  }
}

export function clampConvictionPageLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_CONVICTION_PAGE_LIMIT;
  }
  const whole = Math.trunc(limit);
  if (whole < 1) return DEFAULT_CONVICTION_PAGE_LIMIT;
  return Math.min(whole, MAX_CONVICTION_PAGE_LIMIT);
}

/** Canonical signed path for paginated conviction listing. */
export function agentConvictionsListPath(query: {
  limit?: number;
  cursor?: string;
}): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  const qs = params.toString();
  return qs ? `/api/agents/convictions?${qs}` : "/api/agents/convictions";
}

export function agentConvictionPath(entryId: string): string {
  return `/api/agents/convictions/${encodeURIComponent(entryId)}`;
}

export function agentReceiptPath(receiptId: string): string {
  const params = new URLSearchParams({ receiptId });
  return `/api/agents/receipts?${params.toString()}`;
}

export const AGENT_SUMMARIZE_FEED_PATH = "/api/agents/summarize-feed";
