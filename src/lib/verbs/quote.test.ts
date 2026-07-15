import { describe, it, expect } from "vitest";
import {
  computeFloor,
  isBelowFloor,
  shapeQuote,
  formatEta,
  extractFeeUsd,
  inferSourceChain,
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

  it("prefers the SDK feeQuotes breakdown over a zeroed total fee", () => {
    const quote = shapeQuote(
      {
        totalDecrAmountInUSD: "0.66",
        totalIncrAmountInUSD: "0.50",
        totalFeeInUSD: "0.00",
        decr: [{ token: { chainId: 8453 } }],
      },
      intent,
      0.5,
      "tx-fee",
      { feeQuotes: [{ fees: { totals: { feeTokenAmountInUSD: "0.16" } } }] },
    );
    expect(quote.feeUsd).toBe(0.16);
  });

  it("falls back to the in/out delta when no fee data is present", () => {
    const quote = shapeQuote(
      {
        totalDecrAmountInUSD: "0.66",
        totalIncrAmountInUSD: "0.50",
        decr: [{ token: { chainId: 8453 } }],
      },
      intent,
      0.5,
      "tx-delta",
      {},
    );
    expect(quote.feeUsd).toBeCloseTo(0.16);
  });
});

describe("parseUsd hex decoding", () => {
  it("decodes the SDK's 1e18-scaled hex USD amounts", () => {
    // 0x2c68af0bb13ffff === $0.20 (verified against the live SDK).
    const quote = shapeQuote(
      {
        totalDecrAmountInUSD: "0x2c68af0bb13ffff",
        totalIncrAmountInUSD: "0x2c3f5a84fa6bb89",
        decr: [{ token: { chainId: 42161 } }],
      },
      { toAsset: "eth", destChain: "Arbitrum" },
      0.2,
      "tx-hex",
      { feeQuotes: [{ fees: { totals: { feeTokenAmountInUSD: "0x833368fff0d9a0" } } }] },
    );
    expect(quote.dollarsIn).toBeCloseTo(0.2, 4);
    expect(quote.dollarsOut).toBeCloseTo(0.1993, 3);
    expect(quote.feeUsd).toBeCloseTo(0.0369, 3);
  });
});

describe("extractFeeUsd", () => {
  it("reads the aggregate fee from feeQuotes totals", () => {
    expect(
      extractFeeUsd({
        feeQuotes: [{ fees: { totals: { feeTokenAmountInUSD: "0.16" } } }],
      }),
    ).toBe(0.16);
  });

  it("sums the fee subfields when no aggregate is given", () => {
    expect(
      extractFeeUsd({
        feeQuotes: [
          {
            fees: {
              totals: {
                gasFeeTokenAmountInUSD: "0.10",
                transactionServiceFeeTokenAmountInUSD: "0.04",
                transactionLPFeeTokenAmountInUSD: "0.02",
              },
            },
          },
        ],
      }),
    ).toBeCloseTo(0.16);
  });

  it("returns undefined when there is no fee data", () => {
    expect(extractFeeUsd({})).toBeUndefined();
    expect(extractFeeUsd(null)).toBeUndefined();
  });
});

describe("inferSourceChain", () => {
  it("reads the first debit chain from the SDK changes", () => {
    expect(
      inferSourceChain({
        decr: [
          { token: { chainId: 8453 } },
          { token: { chainId: 42161 } },
        ],
      }),
    ).toBe("Base");
  });

  it("falls back when no debit chain is present", () => {
    expect(inferSourceChain({})).toBe("Unknown");
  });
});

describe("formatEta", () => {
  it("formats seconds and minutes", () => {
    expect(formatEta(30)).toBe("about 30 seconds");
    expect(formatEta(90)).toBe("about 2 minutes");
  });
});
