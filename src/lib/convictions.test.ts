import { describe, it, expect, beforeEach } from "vitest";
import { SEED_CONVICTION } from "@/lib/conviction-seed";
import { DECK_SEED_CARDS } from "@/lib/deck-seed";
import {
  listConvictions,
  listDeckCards,
  saveConviction,
  resetConvictionsMemoryForTests,
} from "@/lib/convictions";
import { buildConviction, hasAnatomy } from "@/lib/verbs/conviction";
import { isDeckCard } from "@/lib/verbs/deck";

describe("convictions memory store", () => {
  beforeEach(() => {
    resetConvictionsMemoryForTests();
  });

  it("includes the seed conviction at cold start", async () => {
    const list = await listConvictions();
    expect(list.some((e) => e.entryId === SEED_CONVICTION.entryId)).toBe(true);
  });

  it("seeds desk deck cards with gate reports", async () => {
    const list = await listConvictions();
    for (const card of DECK_SEED_CARDS) {
      expect(list.some((e) => e.entryId === card.entryId)).toBe(true);
    }
    const deck = await listDeckCards();
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.every(isDeckCard)).toBe(true);
    expect(deck.some((c) => c.trade.token?.symbol === "SURPLUS")).toBe(true);
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

  it("round-trips anatomy fields through save and list", async () => {
    const withAnatomy = buildConviction({
      handle: "desk",
      thesis: "Full anatomy card.",
      trade: {
        fromAsset: "cash",
        fromChain: "Base",
        toAsset: "eth",
        toChain: "Base",
        sizeUsd: 8,
      },
      whyNow: [
        {
          at: "2026-07-10T09:00:00.000Z",
          event: "Trending on GeckoTerminal.",
        },
        { at: "2026-07-12T15:00:00.000Z", event: "Liquidity doubled." },
      ],
      whatBreaksIt: "Contract pause or LP unlock.",
      gateReport: [
        {
          name: "liquidity depth",
          passed: true,
          evidenceUrl: "https://example.com/pool",
        },
        { name: "UA routability", passed: true },
        {
          name: "holder concentration",
          passed: false,
          evidenceUrl: "https://example.com/holders",
        },
      ],
    });
    withAnatomy.createdAt = new Date(Date.now() + 2000).toISOString();

    await saveConviction(withAnatomy);
    const listed = await listConvictions();
    const found = listed.find((e) => e.entryId === withAnatomy.entryId);

    expect(found).toBeDefined();
    expect(found?.whyNow).toEqual(withAnatomy.whyNow);
    expect(found?.whatBreaksIt).toBe(withAnatomy.whatBreaksIt);
    expect(found?.gateReport).toEqual(withAnatomy.gateReport);
    expect(hasAnatomy(found!)).toBe(true);

    // Plain seed remains without anatomy chrome.
    const seed = listed.find((e) => e.entryId === SEED_CONVICTION.entryId);
    expect(seed).toBeDefined();
    expect(hasAnatomy(seed!)).toBe(false);
  });
});
