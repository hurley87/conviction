import { describe, it, expect } from "vitest";
import {
  buildConviction,
  generateConvictionEntryId,
  parseConvictionTrade,
  tradeToConvictionTrade,
} from "@/lib/verbs/conviction";

describe("generateConvictionEntryId", () => {
  it("produces a 16-char hex string", () => {
    const id = generateConvictionEntryId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("buildConviction", () => {
  it("assembles an entry with denormalized handle", () => {
    const entry = buildConviction({
      handle: "alice",
      thesis: "ETH to outperform this week.",
      trade: {
        fromAsset: "eth",
        fromChain: "Base",
        toAsset: "cash",
        toChain: "Arbitrum",
        sizeUsd: 50,
      },
      receiptSlug: "abc123",
    });

    expect(entry.handle).toBe("alice");
    expect(entry.thesis).toBe("ETH to outperform this week.");
    expect(entry.trade.sizeUsd).toBe(50);
    expect(entry.receiptSlug).toBe("abc123");
    expect(entry.backedBy).toEqual([]);
    expect(entry.createdAt).toBeTruthy();
    expect(entry.entryId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("trims thesis whitespace", () => {
    const entry = buildConviction({
      handle: "bob",
      thesis: "  Bullish on BTC.  ",
      trade: {
        fromAsset: "cash",
        fromChain: "Arbitrum",
        toAsset: "btc",
        toChain: "Arbitrum",
        sizeUsd: 100,
      },
    });
    expect(entry.thesis).toBe("Bullish on BTC.");
  });
});

describe("tradeToConvictionTrade", () => {
  it("maps intent + quote + size into conviction trade metadata", () => {
    const trade = tradeToConvictionTrade(
      { toAsset: "cash", destChain: "Arbitrum", fromAsset: "eth" },
      {
        dollarsIn: 25,
        dollarsOut: 24.95,
        feeUsd: 0.05,
        etaSeconds: 30,
        floorUsd: 24.7,
        sourceChain: "Base",
        destChain: "Arbitrum",
        transactionId: "tx-1",
        rawTransaction: {},
      },
      25,
      {
        slug: "receipt1",
        legs: [{ chain: "Base", txHash: "0x1", explorerUrl: "https://example.com" }],
        summary: "done",
        dollarsIn: 25,
        dollarsOut: 24.95,
        feeUsd: 0.05,
      },
    );

    expect(trade).toEqual({
      fromAsset: "eth",
      fromChain: "Base",
      toAsset: "cash",
      toChain: "Arbitrum",
      sizeUsd: 25,
    });
  });
});

describe("parseConvictionTrade", () => {
  it("accepts valid trade payloads", () => {
    const trade = parseConvictionTrade({
      fromAsset: "eth",
      fromChain: "Base",
      toAsset: "cash",
      toChain: "Arbitrum",
      sizeUsd: 10,
    });
    expect(trade?.fromAsset).toBe("eth");
  });

  it("rejects invalid payloads", () => {
    expect(parseConvictionTrade(null)).toBeNull();
    expect(parseConvictionTrade({ fromAsset: "eth" })).toBeNull();
    expect(
      parseConvictionTrade({
        fromAsset: "eth",
        fromChain: "Base",
        toAsset: "cash",
        toChain: "Arbitrum",
        sizeUsd: 0,
      }),
    ).toBeNull();
  });
});
