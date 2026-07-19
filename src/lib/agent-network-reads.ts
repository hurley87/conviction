// Web-side compaction and cursor codec for agent network reads (issue #53).
// Wire types and signed paths live in @getconviction/mcp/agent-reads-contract.

import {
  COMPACT_THESIS_MAX_CHARS,
  DEFAULT_CONVICTION_PAGE_LIMIT,
  MAX_CONVICTION_PAGE_LIMIT,
  type CompactConviction,
  type ConvictionAttribution,
} from "@getconviction/mcp/agent-reads-contract";
import type { BackerAttribution, ConvictionEntry } from "@/lib/verbs/types";

export {
  AGENT_SUMMARIZE_FEED_PATH,
  COMPACT_THESIS_MAX_CHARS,
  DEFAULT_CONVICTION_PAGE_LIMIT,
  MAX_CONVICTION_PAGE_LIMIT,
  agentConvictionPath,
  agentConvictionsListPath,
  agentReceiptPath,
  type CompactConviction,
  type ConvictionAttribution,
} from "@getconviction/mcp/agent-reads-contract";

/** Truncate thesis for list rows without cutting mid-surrogate when possible. */
export function compactThesis(
  thesis: string,
  maxChars = COMPACT_THESIS_MAX_CHARS,
): string {
  const trimmed = thesis.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

/** List rows are compacted; get returns the full canonical ConvictionEntry. */
export function toCompactConviction(entry: ConvictionEntry): CompactConviction {
  const gateReport = entry.gateReport ?? [];
  return {
    entryId: entry.entryId,
    handle: entry.handle,
    thesis: compactThesis(entry.thesis),
    trade: {
      fromAsset: entry.trade.fromAsset,
      toAsset: entry.trade.toAsset,
      sizeUsd: entry.trade.sizeUsd,
      toChain: entry.trade.toChain,
      ...(entry.trade.token?.symbol
        ? { tokenSymbol: entry.trade.token.symbol }
        : {}),
    },
    createdAt: entry.createdAt,
    backerCount: entry.backedBy.length,
    ...(entry.receiptSlug ? { receiptSlug: entry.receiptSlug } : {}),
    ...(entry.authorship ? { authorship: entry.authorship } : {}),
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
  const attributions: BackerAttribution[] =
    entry.backerAttributions ??
    entry.backedBy.map((handle) => ({ handle }));
  return {
    backerCount: entry.backedBy.length,
    backedBy: [...entry.backedBy],
    backers: attributions.map((row) => ({
      handle: row.handle,
      ...(row.authorship
        ? {
            authorKind: row.authorship.authorKind,
            operatorHandle: row.authorship.operatorHandle,
            agentId: row.authorship.agentId,
          }
        : {}),
    })),
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
