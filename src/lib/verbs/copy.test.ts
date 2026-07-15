import { describe, it, expect } from "vitest";
import {
  COPY_TRADE_CAP_USD,
  DEFAULT_COPY_FRACTION,
  copyConviction,
  copyIntent,
  copyTradeSizeUsd,
} from "@/lib/verbs/copy";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import { FloorAbortError } from "@/lib/verbs/types";
import type { ConvictionEntry, UniversalBalance } from "@/lib/verbs/types";

const BALANCE_242: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

const SEED_ENTRY: ConvictionEntry = {
  entryId: "seed-hurley87-eth-cash",
  handle: "hurley87",
  thesis: "ETH looks strong.",
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

describe("copyTradeSizeUsd", () => {
  it("defaults to 10% of unified balance", () => {
    expect(copyTradeSizeUsd(BALANCE_242)).toBe(
      BALANCE_242.totalUsd * DEFAULT_COPY_FRACTION,
    );
  });

  it("caps at COPY_TRADE_CAP_USD", () => {
    const rich: UniversalBalance = {
      totalUsd: 500,
      sources: [{ chain: "Arbitrum", asset: "USDC", usd: 500 }],
    };
    expect(copyTradeSizeUsd(rich)).toBe(COPY_TRADE_CAP_USD);
  });

  it("respects override clamped to balance and cap", () => {
    expect(copyTradeSizeUsd(BALANCE_242, 100)).toBe(COPY_TRADE_CAP_USD);
    expect(copyTradeSizeUsd(BALANCE_242, 5)).toBe(5);
  });

  it("handles tiny balances", () => {
    const tiny: UniversalBalance = {
      totalUsd: 2,
      sources: [{ chain: "Base", asset: "USDC", usd: 2 }],
    };
    expect(copyTradeSizeUsd(tiny)).toBe(0.2);
  });
});

describe("copyIntent", () => {
  it("copies direction and mirrors the original settlement chain", () => {
    const intent = copyIntent(SEED_ENTRY.trade);
    expect(intent.toAsset).toBe("cash");
    expect(intent.fromAsset).toBe("eth");
    expect(intent.destChain).toBe("Arbitrum");
  });

  it("omits fromAsset when original source was cash", () => {
    const intent = copyIntent({
      ...SEED_ENTRY.trade,
      fromAsset: "cash",
      fromChain: "Arbitrum",
    });
    expect(intent.fromAsset).toBeUndefined();
  });

  it("keeps an ETH card on Arbitrum even when the backer is Base-funded", () => {
    const intent = copyIntent({
      fromAsset: "cash",
      fromChain: "Base",
      toAsset: "eth",
      toChain: "Arbitrum",
      sizeUsd: 20,
    });
    expect(intent.toAsset).toBe("eth");
    expect(intent.destChain).toBe("Arbitrum");
  });

  it("re-targets a concrete-token conviction exactly (same token, its chain)", () => {
    const surplus = {
      chainId: 8453,
      address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
      symbol: "SURPLUS",
    };
    const intent = copyIntent({
      fromAsset: "cash",
      fromChain: "Arbitrum",
      toAsset: "token",
      token: surplus,
      toChain: "Base",
      sizeUsd: 100,
    });
    expect(intent.toAsset).toBe("token");
    expect(intent.token).toEqual(surplus);
    // The token defines settlement — Base — even though the backer's funds
    // are mostly on Arbitrum (that's what makes the copy cross-chain).
    expect(intent.destChain).toBe("Base");
    expect(intent.fromAsset).toBeUndefined();
  });
});

describe("copyConviction", () => {
  it("executes a cross-chain copy sized to backer balance, not original sizeUsd", async () => {
    const ua = new MockUAClient();
    const result = await copyConviction(
      SEED_ENTRY,
      {
        ua,
        balance: BALANCE_242,
        signers: mockTradeSigners,
      },
    );

    expect(result.sizeUsd).toBe(copyTradeSizeUsd(BALANCE_242));
    expect(result.sizeUsd).not.toBe(SEED_ENTRY.trade.sizeUsd);
    expect(result.receipt.legs.length).toBeGreaterThanOrEqual(2);
    expect(result.receipt.slug).toBeTruthy();

    const record = ua.tradeRecords[0];
    expect(record?.sourceChain).toBe("Base");
    expect(record?.destChain).toBe("Arbitrum");
    expect(record?.sourceChain).not.toBe(SEED_ENTRY.trade.toChain);
  });

  it("honors an advanced override amount", async () => {
    const ua = new MockUAClient();
    const result = await copyConviction(
      SEED_ENTRY,
      {
        ua,
        balance: BALANCE_242,
        signers: mockTradeSigners,
      },
      8,
    );
    expect(result.sizeUsd).toBe(8);
    expect(ua.tradeRecords[0]?.sizeUsd).toBe(8);
  });

  it("retries once when the fill is below the floor", async () => {
    let calls = 0;
    const ua = new MockUAClient();
    const originalExecute = ua.executeTrade.bind(ua);
    ua.executeTrade = async (params) => {
      calls += 1;
      if (calls === 1) {
        const freshQuote = await ua.quoteTrade({
          intent: params.intent,
          sizeUsd: params.sizeUsd,
        });
        throw new FloorAbortError("stale", freshQuote);
      }
      return originalExecute(params);
    };

    const result = await copyConviction(SEED_ENTRY, {
      ua,
      balance: BALANCE_242,
      signers: mockTradeSigners,
    });
    expect(calls).toBe(2);
    expect(result.receipt).toBeTruthy();
  });
});
