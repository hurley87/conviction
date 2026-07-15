import { describe, it, expect } from "vitest";
import {
  DECK_SIZE_FRACTIONS,
  fractionChipLabel,
  isDeckCard,
  isDeckExhausted,
  orderDeckCards,
  sizeUsdForFraction,
} from "@/lib/verbs/deck";
import { copyTradeSizeUsd, DEFAULT_COPY_FRACTION } from "@/lib/verbs/copy";
import { DECK_SEED_CARDS } from "@/lib/deck-seed";
import type { ConvictionEntry, UniversalBalance } from "@/lib/verbs/types";

const BALANCE: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

const plain: ConvictionEntry = {
  entryId: "plain",
  handle: "x",
  thesis: "no anatomy",
  trade: {
    fromAsset: "cash",
    fromChain: "Base",
    toAsset: "eth",
    toChain: "Arbitrum",
    sizeUsd: 10,
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  backedBy: [],
};

describe("isDeckCard", () => {
  it("requires a gate report", () => {
    expect(isDeckCard(plain)).toBe(false);
    expect(isDeckCard(DECK_SEED_CARDS[0]!)).toBe(true);
  });
});

describe("orderDeckCards", () => {
  it("keeps only deck-eligible cards, newest first", () => {
    const ordered = orderDeckCards([plain, ...DECK_SEED_CARDS]);
    expect(ordered.every(isDeckCard)).toBe(true);
    expect(ordered[0]?.entryId).toBe("deck-hero-eth-arb");
    expect(ordered.some((c) => c.entryId === "plain")).toBe(false);
  });

  it("includes the TokenRef SURPLUS card", () => {
    const tokenCard = orderDeckCards(DECK_SEED_CARDS).find(
      (c) => c.trade.token?.symbol === "SURPLUS",
    );
    expect(tokenCard).toBeTruthy();
    expect(tokenCard?.trade.toAsset).toBe("token");
  });
});

describe("sizeUsdForFraction", () => {
  it("delegates to copyTradeSizeUsd for every preset", () => {
    for (const fraction of DECK_SIZE_FRACTIONS) {
      expect(sizeUsdForFraction(BALANCE, fraction)).toBe(
        copyTradeSizeUsd(BALANCE, BALANCE.totalUsd * fraction),
      );
    }
  });

  it("defaults match one-tap copy at 10%", () => {
    expect(sizeUsdForFraction(BALANCE, DEFAULT_COPY_FRACTION)).toBe(
      copyTradeSizeUsd(BALANCE),
    );
  });

  it("exposes the sizing-sheet presets", () => {
    expect([...DECK_SIZE_FRACTIONS]).toEqual([0.05, 0.1, 0.25, 0.5, 1]);
  });

  it("caps at COPY_TRADE_CAP_USD for large fractions", () => {
    expect(sizeUsdForFraction(BALANCE, 1)).toBe(25);
  });

  it("returns 0 for empty balance", () => {
    expect(
      sizeUsdForFraction({ totalUsd: 0, sources: [] }, 0.1),
    ).toBe(0);
  });
});

describe("fractionChipLabel", () => {
  it("labels in percent and dollars only", () => {
    const chip = fractionChipLabel(BALANCE, 0.1);
    expect(chip.pct).toBe("10%");
    expect(chip.usd).toBeCloseTo(24.25);
    expect(JSON.stringify(chip)).not.toMatch(/Arbitrum|Base|chain/i);
  });

  it("labels full balance as All", () => {
    expect(fractionChipLabel(BALANCE, 1).pct).toBe("All");
  });
});

describe("isDeckExhausted", () => {
  it("is exhausted when index is past the last card", () => {
    expect(isDeckExhausted(DECK_SEED_CARDS, 0)).toBe(false);
    expect(isDeckExhausted(DECK_SEED_CARDS, DECK_SEED_CARDS.length)).toBe(
      true,
    );
    expect(isDeckExhausted([], 0)).toBe(true);
  });
});
