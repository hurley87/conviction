import { describe, expect, it } from "vitest";
import {
  availableTradeFundingSources,
  availableTradeUsd,
} from "@/lib/trade-sources";
import type { UniversalBalance } from "@/lib/verbs/types";

const balance: UniversalBalance = {
  totalUsd: 75,
  sources: [
    { chain: "Base", asset: "USDC", usd: 20 },
    { chain: "Arbitrum", asset: "USDC", usd: 10 },
    { chain: "Base", asset: "WETH", usd: 40 },
    { chain: "Arbitrum", asset: "WBTC", usd: 5 },
  ],
};

describe("trade funding sources", () => {
  it("aggregates supported primary assets across networks", () => {
    expect(availableTradeFundingSources(balance)).toEqual([
      { asset: "eth", symbol: "ETH", usd: 40 },
      { asset: "usdc", symbol: "USDC", usd: 30 },
    ]);
  });

  it("uses the unified balance for Any and the asset slice for a selection", () => {
    expect(availableTradeUsd(balance, null)).toBe(75);
    expect(availableTradeUsd(balance, "usdc")).toBe(30);
    expect(availableTradeUsd(balance, "sol")).toBe(0);
  });
});
