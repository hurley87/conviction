import { describe, it, expect } from "vitest";
import {
  buildBuyPayload,
  buildConvertPayload,
  defaultTradeConfig,
  isSellIntent,
} from "@/lib/ua/trade";
import {
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  tokenAddress,
} from "@/lib/verbs/chains";
import type { TradeIntent } from "@/lib/verbs/types";

describe("buildBuyPayload", () => {
  it("bounds the trade to amountInUSD with the resolved dest token", () => {
    const intent: TradeIntent = { toAsset: "cash", destChain: "Arbitrum" };
    const payload = buildBuyPayload(intent, 0.5);

    expect(payload.amountInUSD).toBe("0.50");
    expect(payload.token.chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(payload.token.address).toBe(tokenAddress("usdc", ARBITRUM_CHAIN_ID));
    expect(payload.token.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("formats the amount to two decimals", () => {
    const intent: TradeIntent = { toAsset: "cash", destChain: "Arbitrum" };
    expect(buildBuyPayload(intent, 121.25).amountInUSD).toBe("121.25");
  });

  it("settles a buy on the intent's chosen chain (Base)", () => {
    const intent: TradeIntent = { toAsset: "eth", destChain: "Base" };
    const payload = buildBuyPayload(intent, 0.5);

    expect(payload.token.chainId).toBe(BASE_CHAIN_ID);
    expect(payload.token.address).toBe(tokenAddress("eth", BASE_CHAIN_ID));
  });
});

describe("isSellIntent", () => {
  it("keeps a USD-sized USDC to ETH trade on the USD-bounded buy path (issue #84)", () => {
    const intent: TradeIntent = {
      toAsset: "eth",
      fromAsset: "usdc",
      destChain: "Base",
    };

    // Particle's convert expectToken.amount is denominated in destination-token
    // units. Routing sizeUsd=1 through convert therefore requests 1 ETH, not $1.
    const routesThroughConvert = isSellIntent(intent);
    expect({
      route: routesThroughConvert ? "convert" : "buy",
      submittedAmount: routesThroughConvert
        ? buildConvertPayload(intent, 1).expectToken
        : { amountInUSD: buildBuyPayload(intent, 1).amountInUSD },
      tradeConfig: defaultTradeConfig(intent.fromAsset),
    }).toEqual({
      route: "buy",
      submittedAmount: { amountInUSD: "1.00" },
      tradeConfig: { slippageBps: 100, usePrimaryTokens: ["usdc"] },
    });
  });

  it("is true when converting a held non-cash asset", () => {
    expect(
      isSellIntent({ toAsset: "cash", fromAsset: "eth", destChain: "Arbitrum" }),
    ).toBe(true);
  });

  it("is false for a plain buy (no source asset)", () => {
    expect(isSellIntent({ toAsset: "eth", destChain: "Arbitrum" })).toBe(false);
  });

  it("is false when the source is cash", () => {
    expect(
      isSellIntent({ toAsset: "eth", fromAsset: "cash", destChain: "Arbitrum" }),
    ).toBe(false);
  });

  it("is false for a concrete-token buy with a selected primary source", () => {
    expect(
      isSellIntent({
        toAsset: "token",
        fromAsset: "eth",
        token: {
          chainId: BASE_CHAIN_ID,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
        destChain: "Base",
      }),
    ).toBe(false);
  });
});

describe("buildConvertPayload", () => {
  it("targets the destination token type on the settlement chain", () => {
    const intent: TradeIntent = {
      toAsset: "cash",
      fromAsset: "eth",
      destChain: "Arbitrum",
    };
    const payload = buildConvertPayload(intent, 0.5);
    expect(payload.chainId).toBe(ARBITRUM_CHAIN_ID);
    expect(payload.expectToken.type).toBe("usdc"); // cash → USDC token type
    expect(payload.expectToken.amount).toBe("0.50");
  });
});

describe("defaultTradeConfig", () => {
  it("sets a 1% slippage floor (gas abstraction is always-on in SDK v2)", () => {
    const config = defaultTradeConfig();
    expect(config.slippageBps).toBe(100);
    expect(config.usePrimaryTokens).toBeUndefined();
  });

  it("constrains the source token when selling a specific asset", () => {
    const config = defaultTradeConfig("eth");
    expect(config.usePrimaryTokens).toEqual(["eth"]);
  });
});

describe("buildBuyPayload with a concrete TokenRef", () => {
  it("uses the ref's chain and address verbatim, bypassing the table", () => {
    const payload = buildBuyPayload(
      {
        toAsset: "token",
        token: {
          chainId: 8453,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
        destChain: "Base",
      },
      5,
    );
    expect(payload.token).toEqual({
      chainId: 8453,
      address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
    });
    expect(payload.amountInUSD).toBe("5.00");
  });
});
