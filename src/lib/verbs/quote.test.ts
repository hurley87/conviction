import { describe, it, expect } from "vitest";
import {
  computeFloor,
  isBelowFloor,
  shapeQuote,
  formatEta,
  DEFAULT_FLOOR_TOLERANCE,
} from "@/lib/verbs/quote";
import type { TradeIntent } from "@/lib/verbs/types";

const intent: TradeIntent = {
  toAsset: "cash",
  destChain: "Arbitrum",
  sizeUsd: 25,
};

describe("computeFloor", () => {
  it("applies 1% default tolerance (ADR 0011)", () => {
    expect(computeFloor(100)).toBeCloseTo(99);
    expect(DEFAULT_FLOOR_TOLERANCE).toBe(0.01);
  });
});

describe("isBelowFloor", () => {
  it("detects fills below the agreed floor", () => {
    expect(isBelowFloor(98, 99)).toBe(true);
    expect(isBelowFloor(99, 99)).toBe(false);
    expect(isBelowFloor(100, 99)).toBe(false);
  });
});

describe("shapeQuote", () => {
  it("maps SDK tokenChanges to jargon-free confirm card fields", () => {
    const quote = shapeQuote(
      {
        totalDecrAmountInUSD: "25.00",
        totalIncrAmountInUSD: "24.88",
        totalFeeInUSD: "0.12",
        decr: [{ token: { chainId: 8453 } }],
      },
      intent,
      25,
      "tx-1",
      {},
    );

    expect(quote.dollarsIn).toBe(25);
    expect(quote.dollarsOut).toBe(24.88);
    expect(quote.feeUsd).toBe(0.12);
    expect(quote.floorUsd).toBeCloseTo(24.88 * 0.99);
    expect(quote.sourceChain).toBe("Base");
    expect(quote.destChain).toBe("Arbitrum");
  });
});

describe("formatEta", () => {
  it("formats seconds and minutes", () => {
    expect(formatEta(30)).toBe("about 30 seconds");
    expect(formatEta(90)).toBe("about 2 minutes");
  });
});
