import { describe, it, expect } from "vitest";
import { buildBuyPayload, defaultTradeConfig } from "@/lib/ua/trade";
import { ARBITRUM_CHAIN_ID, tokenAddress } from "@/lib/verbs/chains";
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
});

describe("defaultTradeConfig", () => {
  it("enables universal gas and a 1% slippage floor", () => {
    const config = defaultTradeConfig();
    expect(config.universalGas).toBe(true);
    expect(config.slippageBps).toBe(100);
    expect(config.usePrimaryTokens).toBeUndefined();
  });

  it("constrains the source token when selling a specific asset", () => {
    const config = defaultTradeConfig("eth");
    expect(config.usePrimaryTokens).toEqual(["eth"]);
  });
});
