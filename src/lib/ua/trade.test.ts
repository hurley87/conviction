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
