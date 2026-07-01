import { describe, it, expect } from "vitest";
import {
  buildDigest,
  flagConvictions,
  isFeedSummaryRequest,
  summarizeFeedFromEntries,
} from "@/lib/verbs/feed-summary";
import type { ConvictionEntry } from "@/lib/verbs/types";

function makeEntry(
  overrides: Partial<ConvictionEntry> & Pick<ConvictionEntry, "entryId" | "handle">,
): ConvictionEntry {
  return {
    thesis:
      "ETH looks strong into Q3 — moving a small slice to cash while keeping exposure elsewhere.",
    trade: {
      fromAsset: "eth",
      fromChain: "Base",
      toAsset: "cash",
      toChain: "Arbitrum",
      sizeUsd: 25,
    },
    createdAt: "2026-06-28T18:00:00.000Z",
    backedBy: [],
    ...overrides,
  };
}

describe("isFeedSummaryRequest", () => {
  it("matches explicit feed summary phrasings", () => {
    expect(isFeedSummaryRequest("summarize the feed")).toBe(true);
    expect(isFeedSummaryRequest("sanity-check the feed")).toBe(true);
    expect(isFeedSummaryRequest("give me a recap of the convictions")).toBe(
      true,
    );
    expect(isFeedSummaryRequest("what's on the feed")).toBe(true);
  });

  it("rejects trade phrasings", () => {
    expect(isFeedSummaryRequest("buy ETH for $25")).toBe(false);
    expect(isFeedSummaryRequest("move $25 to cash")).toBe(false);
    expect(isFeedSummaryRequest("convert half my ETH to cash")).toBe(false);
  });
});

describe("flagConvictions", () => {
  it("flags thin rationale", () => {
    const entries = [
      makeEntry({
        entryId: "thin-1",
        handle: "trader1",
        thesis: "moon",
      }),
    ];
    const flagged = flagConvictions(entries);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.entryId).toBe("thin-1");
    expect(flagged[0]!.reason).toContain("thin rationale");
  });

  it("flags unusually large size relative to feed", () => {
    const entries = [
      makeEntry({ entryId: "small-1", handle: "a", trade: { fromAsset: "cash", fromChain: "Arbitrum", toAsset: "eth", toChain: "Arbitrum", sizeUsd: 25 } }),
      makeEntry({ entryId: "small-2", handle: "b", trade: { fromAsset: "cash", fromChain: "Arbitrum", toAsset: "eth", toChain: "Arbitrum", sizeUsd: 30 } }),
      makeEntry({ entryId: "large-1", handle: "whale", trade: { fromAsset: "cash", fromChain: "Arbitrum", toAsset: "eth", toChain: "Arbitrum", sizeUsd: 500 } }),
    ];
    const flagged = flagConvictions(entries);
    expect(flagged.some((f) => f.entryId === "large-1")).toBe(true);
    expect(flagged.find((f) => f.entryId === "large-1")!.reason).toContain(
      "much larger than typical",
    );
  });

  it("does not flag normal entries", () => {
    const entries = [makeEntry({ entryId: "ok-1", handle: "hurley87" })];
    expect(flagConvictions(entries)).toHaveLength(0);
  });

  it("returns empty for empty feed", () => {
    expect(flagConvictions([])).toEqual([]);
  });
});

describe("buildDigest / summarizeFeedFromEntries", () => {
  it("mentions entry count and handles", () => {
    const entries = [
      makeEntry({ entryId: "e1", handle: "alice" }),
      makeEntry({ entryId: "e2", handle: "bob" }),
    ];
    const digest = buildDigest(entries, []);
    expect(digest).toMatch(/2 convictions/);
    expect(digest).toMatch(/@alice/);
  });

  it("handles empty feed", () => {
    const summary = summarizeFeedFromEntries([]);
    expect(summary.digest).toMatch(/empty/i);
    expect(summary.flagged).toEqual([]);
  });

  it("returns flagged entryIds in summary", () => {
    const entries = [
      makeEntry({ entryId: "flagged-1", handle: "risky", thesis: "yolo" }),
    ];
    const summary = summarizeFeedFromEntries(entries);
    expect(summary.flagged).toContain("flagged-1");
    expect(summary.flaggedEntries[0]!.handle).toBe("risky");
  });
});
