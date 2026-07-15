import { describe, it, expect } from "vitest";
import {
  buildConviction,
  buildDeskCard,
  generateConvictionEntryId,
  appendBacker,
  entryPrecedesPublication,
  hasAnatomy,
  parseConvictionTrade,
  parseGateReport,
  parseWhatBreaksIt,
  parseWhyNow,
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

  it("includes optional anatomy when present", () => {
    const entry = buildConviction({
      handle: "desk",
      thesis: "Base meme looks liquid.",
      trade: {
        fromAsset: "cash",
        fromChain: "Base",
        toAsset: "eth",
        toChain: "Base",
        sizeUsd: 10,
      },
      whyNow: [
        { at: "2026-07-14T12:00:00.000Z", event: "Volume spike on Base." },
      ],
      whatBreaksIt: "Liquidity dries below $50k.",
      gateReport: [
        {
          name: "liquidity depth",
          passed: true,
          evidenceUrl: "https://example.com/liq",
        },
        { name: "UA routability", passed: true },
      ],
    });

    expect(entry.whyNow).toEqual([
      { at: "2026-07-14T12:00:00.000Z", event: "Volume spike on Base." },
    ]);
    expect(entry.whatBreaksIt).toBe("Liquidity dries below $50k.");
    expect(entry.gateReport).toHaveLength(2);
    expect(hasAnatomy(entry)).toBe(true);
  });

  it("omits anatomy fields when absent", () => {
    const entry = buildConviction({
      handle: "alice",
      thesis: "Plain thesis.",
      trade: {
        fromAsset: "eth",
        fromChain: "Base",
        toAsset: "cash",
        toChain: "Arbitrum",
        sizeUsd: 50,
      },
    });
    expect(entry).not.toHaveProperty("whyNow");
    expect(entry).not.toHaveProperty("whatBreaksIt");
    expect(entry).not.toHaveProperty("gateReport");
    expect(hasAnatomy(entry)).toBe(false);
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
        toAsset: "cash",
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

  it("carries TokenRef through to conviction trade metadata", () => {
    const token = {
      chainId: 8453,
      address: "0xSurplus",
      symbol: "SURPLUS",
    };
    const trade = tradeToConvictionTrade(
      { toAsset: "token", token, destChain: "Base" },
      {
        dollarsIn: 8,
        dollarsOut: 7.9,
        feeUsd: 0.1,
        etaSeconds: 30,
        floorUsd: 7.8,
        sourceChain: "Arbitrum",
        destChain: "Base",
        toAsset: "token",
        receivedSymbol: "SURPLUS",
        transactionId: "tx-token",
        rawTransaction: {},
      },
      8,
    );
    expect(trade.token).toEqual(token);
    expect(trade.toAsset).toBe("token");
  });
});

describe("appendBacker", () => {
  it("appends a handle", () => {
    expect(appendBacker(["alice"], "bob")).toEqual(["alice", "bob"]);
  });

  it("dedupes handles", () => {
    expect(appendBacker(["alice", "bob"], "bob")).toEqual(["alice", "bob"]);
  });

  it("ignores empty handles", () => {
    expect(appendBacker(["alice"], "  ")).toEqual(["alice"]);
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

  it("round-trips a concrete TokenRef", () => {
    const trade = parseConvictionTrade({
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
    });
    expect(trade).toEqual({
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
    });
  });

  it("rejects token sentinel without TokenRef", () => {
    expect(
      parseConvictionTrade({
        fromAsset: "cash",
        fromChain: "Base",
        toAsset: "token",
        toChain: "Base",
        sizeUsd: 8,
      }),
    ).toBeNull();
  });

  it("rejects TokenRef when toAsset is not token", () => {
    expect(
      parseConvictionTrade({
        fromAsset: "cash",
        fromChain: "Base",
        toAsset: "eth",
        token: {
          chainId: 8453,
          address: "0xabc",
          symbol: "X",
        },
        toChain: "Base",
        sizeUsd: 8,
      }),
    ).toBeNull();
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

describe("entryPrecedesPublication", () => {
  it("allows entry before or equal to publication", () => {
    expect(
      entryPrecedesPublication(
        "2026-07-15T18:20:44.000Z",
        "2026-07-15T18:25:00.000Z",
      ),
    ).toBe(true);
    expect(
      entryPrecedesPublication(
        "2026-07-15T18:20:44.000Z",
        "2026-07-15T18:20:44.000Z",
      ),
    ).toBe(true);
  });

  it("rejects entry after publication", () => {
    expect(
      entryPrecedesPublication(
        "2026-07-15T19:00:00.000Z",
        "2026-07-15T18:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("buildDeskCard", () => {
  const tokenTrade = {
    fromAsset: "cash" as const,
    fromChain: "Base",
    toAsset: "token" as const,
    token: {
      chainId: 8453,
      address: "0xSurplusTokenAddress",
      symbol: "SURPLUS",
    },
    toChain: "Base" as const,
    sizeUsd: 8,
  };

  it("builds a full-anatomy card with TokenRef and receipt", () => {
    const entry = buildDeskCard({
      handle: "desk",
      thesis: "Base meme looks liquid.",
      trade: tokenTrade,
      receiptSlug: "entry-receipt-1",
      entryAt: "2026-07-15T18:20:44.000Z",
      publishedAt: "2026-07-15T18:25:00.000Z",
      whyNow: [
        { at: "2026-07-14T12:00:00.000Z", event: "Volume spike on Base." },
      ],
      whatBreaksIt: "Liquidity dries below $50k.",
      gateReport: [
        { name: "liquidity depth", passed: true },
        { name: "UA routability", passed: true },
      ],
    });

    expect(entry.handle).toBe("desk");
    expect(entry.receiptSlug).toBe("entry-receipt-1");
    expect(entry.trade.token?.symbol).toBe("SURPLUS");
    expect(entry.whyNow).toHaveLength(1);
    expect(entry.whatBreaksIt).toBe("Liquidity dries below $50k.");
    expect(entry.gateReport).toHaveLength(2);
    expect(entry.createdAt).toBe("2026-07-15T18:25:00.000Z");
    expect(hasAnatomy(entry)).toBe(true);
  });

  it("rejects when entry is after publication", () => {
    expect(() =>
      buildDeskCard({
        handle: "desk",
        thesis: "Too early.",
        trade: tokenTrade,
        receiptSlug: "r1",
        entryAt: "2026-07-15T19:00:00.000Z",
        publishedAt: "2026-07-15T18:00:00.000Z",
        whyNow: [{ at: "2026-07-14", event: "x" }],
        whatBreaksIt: "y",
        gateReport: [{ name: "z", passed: true }],
      }),
    ).toThrow(/precede/);
  });
});

describe("parseWhyNow", () => {
  it("returns undefined when absent", () => {
    expect(parseWhyNow(undefined)).toBeUndefined();
    expect(parseWhyNow(null)).toBeUndefined();
    expect(parseWhyNow([])).toBeUndefined();
  });

  it("accepts dated events", () => {
    expect(
      parseWhyNow([
        { at: "2026-07-01", event: " Listing day " },
        { at: "2026-07-02T00:00:00.000Z", event: "Whale buy" },
      ]),
    ).toEqual([
      { at: "2026-07-01", event: "Listing day" },
      { at: "2026-07-02T00:00:00.000Z", event: "Whale buy" },
    ]);
  });

  it("rejects invalid shapes", () => {
    expect(parseWhyNow("nope")).toBeNull();
    expect(parseWhyNow([{ at: "2026-07-01" }])).toBeNull();
    expect(parseWhyNow([{ event: "missing at" }])).toBeNull();
  });
});

describe("parseWhatBreaksIt", () => {
  it("returns undefined when absent or blank", () => {
    expect(parseWhatBreaksIt(undefined)).toBeUndefined();
    expect(parseWhatBreaksIt("  ")).toBeUndefined();
  });

  it("trims a string falsifier", () => {
    expect(parseWhatBreaksIt("  Rug risk.  ")).toBe("Rug risk.");
  });

  it("rejects non-strings", () => {
    expect(parseWhatBreaksIt(42)).toBeNull();
  });
});

describe("parseGateReport", () => {
  it("returns undefined when absent", () => {
    expect(parseGateReport(undefined)).toBeUndefined();
    expect(parseGateReport([])).toBeUndefined();
  });

  it("accepts structured checks", () => {
    expect(
      parseGateReport([
        {
          name: " liquidity ",
          passed: true,
          evidenceUrl: " https://ex.com ",
        },
        { name: "holders", passed: false },
      ]),
    ).toEqual([
      {
        name: "liquidity",
        passed: true,
        evidenceUrl: "https://ex.com",
      },
      { name: "holders", passed: false },
    ]);
  });

  it("rejects invalid checks", () => {
    expect(parseGateReport("blob")).toBeNull();
    expect(parseGateReport([{ name: "x" }])).toBeNull();
    expect(parseGateReport([{ passed: true }])).toBeNull();
    expect(
      parseGateReport([{ name: "x", passed: true, evidenceUrl: 1 }]),
    ).toBeNull();
  });
});
