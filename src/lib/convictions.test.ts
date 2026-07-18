import { describe, it, expect, beforeEach } from "vitest";
import { SEED_CONVICTION } from "@/lib/conviction-seed";
import { DECK_SEED_CARDS } from "@/lib/deck-seed";
import {
  addBacker,
  getConviction,
  listConvictions,
  listConvictionsPage,
  listDeckCards,
  saveConviction,
  resetConvictionsMemoryForTests,
} from "@/lib/convictions";
import {
  buildConviction,
  buildDeskCard,
  hasAnatomy,
  parseConvictionTrade,
} from "@/lib/verbs/conviction";
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
      receiptSlug: "desk-entry-1",
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

  it("fetches one conviction by entryId", async () => {
    const found = await getConviction(SEED_CONVICTION.entryId);
    expect(found?.entryId).toBe(SEED_CONVICTION.entryId);
    expect(await getConviction("missing-entry")).toBeNull();
  });

  it("paginates convictions with a stable keyset cursor", async () => {
    const first = await listConvictionsPage({ limit: 1 });
    expect(first.entries).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = await listConvictionsPage({
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.entryId).not.toBe(first.entries[0]?.entryId);

    await expect(
      listConvictionsPage({ cursor: "%%%bad%%%" }),
    ).rejects.toMatchObject({ code: "invalid_cursor" });
  });

  it("round-trips desk TokenRef + anatomy via parse → build → save → list", async () => {
    const rawTrade = {
      fromAsset: "cash",
      fromChain: "Arbitrum",
      toAsset: "token",
      token: {
        chainId: 8453,
        address: "0xSurplusTokenAddress",
        symbol: "SURPLUS",
      },
      toChain: "Base",
      sizeUsd: 8,
    };
    const trade = parseConvictionTrade(rawTrade);
    expect(trade?.token?.address).toBe("0xSurplusTokenAddress");

    const entry = buildDeskCard({
      handle: "desk",
      thesis: "Concrete Base token with full anatomy.",
      trade: trade!,
      receiptSlug: "token-entry-1",
      entryAt: "2026-07-15T10:00:00.000Z",
      publishedAt: "2026-07-15T10:05:00.000Z",
      whyNow: [
        { at: "2026-07-14T12:00:00.000Z", event: "Pool depth cleared gate." },
      ],
      whatBreaksIt: "LP unlock cliff.",
      gateReport: [
        { name: "UA routability", passed: true },
        { name: "liquidity depth", passed: true },
      ],
    });

    await saveConviction(entry);
    const listed = await listConvictions();
    const found = listed.find((e) => e.entryId === entry.entryId);

    expect(found?.trade.token).toEqual(rawTrade.token);
    expect(found?.receiptSlug).toBe("token-entry-1");
    expect(found?.whyNow).toEqual(entry.whyNow);
    expect(found?.whatBreaksIt).toBe(entry.whatBreaksIt);
    expect(found?.gateReport).toEqual(entry.gateReport);
    expect(found?.createdAt).toBe("2026-07-15T10:05:00.000Z");
  });

  it("upgrades handle-only backer attribution when authorship arrives", async () => {
    const entry = buildConviction({
      handle: "desk",
      thesis: "Attribution upgrade.",
      trade: {
        fromAsset: "cash",
        fromChain: "Arbitrum",
        toAsset: "eth",
        toChain: "Arbitrum",
        sizeUsd: 10,
      },
    });
    await saveConviction(entry);

    await addBacker(entry.entryId, "signal-scout");
    const before = await getConviction(entry.entryId);
    expect(before?.backerAttributions).toEqual([{ handle: "signal-scout" }]);

    const authorship = {
      agentId: "00000000-0000-4000-8000-000000000058",
      authorKind: "agent" as const,
      handle: "signal-scout",
      operatorHandle: "alice",
    };
    await addBacker(entry.entryId, "signal-scout", authorship);
    const after = await getConviction(entry.entryId);
    expect(after?.backedBy).toEqual(["signal-scout"]);
    expect(after?.backerAttributions).toEqual([
      { handle: "signal-scout", authorship },
    ]);
  });
});
