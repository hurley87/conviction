import { describe, it, expect } from "vitest";
import { summarizeFeedDigest } from "@/lib/feed-summary-llm";
import { buildDigest } from "@/lib/verbs/feed-summary";
import type { ConvictionEntry } from "@/lib/verbs/types";

const sampleEntry: ConvictionEntry = {
  entryId: "seed-1",
  handle: "hurley87",
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
};

// With no AI_GATEWAY_API_KEY, IS_LLM_PARSING is false — must use deterministic digest.
describe("summarizeFeedDigest (no gateway configured)", () => {
  it("falls back to buildDigest", async () => {
    const entries = [sampleEntry];
    const flagged: { entryId: string; handle: string; reason: string }[] = [];
    const result = await summarizeFeedDigest(entries, flagged);
    expect(result).toBe(buildDigest(entries, flagged));
  });
});
