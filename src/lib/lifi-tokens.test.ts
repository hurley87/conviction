import { describe, expect, it } from "vitest";
import {
  searchTradeTokens,
  sortTradeTokens,
  type TradeToken,
} from "@/lib/lifi-tokens";

const tokens: TradeToken[] = [
  {
    address: "0xbase-eth",
    chainId: 8453,
    symbol: "WETH",
    name: "Wrapped Ether",
    priceUSD: 3000,
  },
  {
    address: "0xarb-usdc",
    chainId: 42161,
    symbol: "USDC",
    name: "USD Coin",
    priceUSD: 1,
  },
  {
    address: "0xbase-usdc",
    chainId: 8453,
    symbol: "USDC",
    name: "USD Coin",
    priceUSD: 1,
  },
  {
    address: "0xbase-usdc",
    chainId: 8453,
    symbol: "USDC",
    name: "Duplicate",
    priceUSD: 1,
  },
];

describe("trade tokens", () => {
  it("preserves one token per chain/address and keeps chain identity", () => {
    const sorted = sortTradeTokens(tokens);
    expect(sorted).toHaveLength(3);
    expect(
      sorted.filter((token) => token.symbol === "USDC").map((token) => token.chainId),
    ).toEqual([42161, 8453]);
  });

  it("searches by symbol, name, and exact address", () => {
    expect(searchTradeTokens(sortTradeTokens(tokens), "wrapped")[0]?.symbol).toBe(
      "WETH",
    );
    expect(searchTradeTokens(sortTradeTokens(tokens), "USDC")).toHaveLength(2);
    expect(
      searchTradeTokens(sortTradeTokens(tokens), "0xarb-usdc")[0]?.chainId,
    ).toBe(42161);
  });
});
