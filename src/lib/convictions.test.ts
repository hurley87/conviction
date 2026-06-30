import { describe, it, expect, beforeEach } from "vitest";
import { SEED_CONVICTION } from "@/lib/conviction-seed";
import {
  listConvictions,
  saveConviction,
  resetConvictionsMemoryForTests,
} from "@/lib/convictions";
import { buildConviction } from "@/lib/verbs/conviction";

describe("convictions memory store", () => {
  beforeEach(() => {
    resetConvictionsMemoryForTests();
  });

  it("includes the seed conviction at cold start", async () => {
    const list = await listConvictions();
    expect(list.some((e) => e.entryId === SEED_CONVICTION.entryId)).toBe(true);
  });

  it("orders newest first after saving", async () => {
    const newer = buildConviction({
      handle: "tester",
      thesis: "Newest entry.",
      trade: {
        fromAsset: "cash",
        fromChain: "Arbitrum",
        toAsset: "eth",
        toChain: "Arbitrum",
        sizeUsd: 15,
      },
    });
    newer.createdAt = new Date(Date.now() + 1000).toISOString();

    await saveConviction(newer);
    const list = await listConvictions();
    expect(list[0]?.entryId).toBe(newer.entryId);
  });
});
