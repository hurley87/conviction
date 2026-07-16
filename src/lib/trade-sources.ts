import { assetMatches, productAssetPrimarySymbol } from "@/lib/verbs/assets";
import type { ProductAsset, UniversalBalance } from "@/lib/verbs/types";

export type TradeFundingAsset = Extract<
  ProductAsset,
  "usdc" | "usdt" | "eth" | "sol"
>;

export type TradeFundingSource = {
  asset: TradeFundingAsset;
  symbol: string;
  usd: number;
};

const FUNDING_ASSETS: TradeFundingAsset[] = ["usdc", "usdt", "eth", "sol"];

export function availableTradeFundingSources(
  balance: UniversalBalance | null | undefined,
): TradeFundingSource[] {
  if (!balance) return [];
  return FUNDING_ASSETS.map((asset) => ({
    asset,
    symbol: productAssetPrimarySymbol(asset),
    usd: balance.sources
      .filter((source) => assetMatches(source.asset, asset))
      .reduce((sum, source) => sum + source.usd, 0),
  }))
    .filter((source) => source.usd > 0)
    .sort((a, b) => b.usd - a.usd);
}

export function availableTradeUsd(
  balance: UniversalBalance | null | undefined,
  source: TradeFundingAsset | null,
): number {
  if (!balance) return 0;
  if (!source) return balance.totalUsd;
  return (
    availableTradeFundingSources(balance).find(
      (candidate) => candidate.asset === source,
    )?.usd ?? 0
  );
}
