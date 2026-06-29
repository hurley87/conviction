// Pure mapping from the Particle UA `getPrimaryAssets()` response shape to our
// chain-agnostic UniversalBalance. Kept SDK-free so it is unit-testable without
// the SDK (ADR 0014 — the verb layer is the mockable seam).

import type { UniversalBalance, BalanceSource } from "@/lib/verbs/types";

/** Minimal structural subset of the SDK's IAssetsResponse we depend on. */
export type RawChainAggregation = {
  token?: { chainId?: number; symbol?: string };
  amountInUSD?: number;
};
export type RawAsset = {
  tokenType?: string;
  amountInUSD?: number;
  chainAggregation?: RawChainAggregation[];
};
export type RawPrimaryAssets = {
  totalAmountInUSD?: number;
  assets?: RawAsset[];
};

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

export function chainName(chainId: number | undefined): string {
  if (chainId == null) return "Unknown";
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

/** Sum a balance's per-source USD values into one unified total. */
export function sumSources(sources: BalanceSource[]): number {
  return sources.reduce((acc, s) => acc + s.usd, 0);
}

/**
 * Flatten the per-asset, per-chain aggregation into one source row per
 * chain+asset, and surface the SDK's authoritative total.
 */
export function toUniversalBalance(res: RawPrimaryAssets): UniversalBalance {
  const sources: BalanceSource[] = [];

  for (const asset of res.assets ?? []) {
    const symbol = asset.tokenType ?? "?";
    for (const agg of asset.chainAggregation ?? []) {
      const usd = agg.amountInUSD ?? 0;
      if (usd <= 0) continue;
      sources.push({
        chain: chainName(agg.token?.chainId),
        asset: agg.token?.symbol ?? symbol,
        usd,
      });
    }
  }

  return {
    totalUsd: res.totalAmountInUSD ?? sumSources(sources),
    sources,
  };
}
