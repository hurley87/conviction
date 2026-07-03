"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiFiTokens } from "@/hooks/use-lifi-tokens";
import { assetMatches } from "@/lib/verbs/assets";
import type { BalanceSource, ProductAsset } from "@/lib/verbs/types";
import { AssetRow } from "@/components/home/asset-row";

type AssetTab = "coins" | "collectibles" | "orders";

type AggregatedAsset = {
  symbol: string;
  name: string;
  usd: number;
  productAsset: ProductAsset;
};

/** Concrete holding products (excludes the `cash` aggregate). */
const DISPLAY_PRODUCTS: ProductAsset[] = ["usdc", "usdt", "eth", "btc", "sol"];

/** Human-readable name per balance symbol. Aliases resolve via the registry. */
const DISPLAY_NAMES: Record<string, string> = {
  USDC: "USDC",
  USDT: "Tether USD",
  ETH: "Ethereum",
  WETH: "Ethereum",
  BTC: "Bitcoin",
  WBTC: "Bitcoin",
  SOL: "Solana",
};

function symbolToProductAsset(symbol: string): ProductAsset {
  return DISPLAY_PRODUCTS.find((p) => assetMatches(symbol, p)) ?? "usdc";
}

function aggregateSources(sources: BalanceSource[]): AggregatedAsset[] {
  const bySymbol = new Map<string, AggregatedAsset>();

  for (const source of sources) {
    const symbol = source.asset.toUpperCase();
    const existing = bySymbol.get(symbol);
    if (existing) {
      existing.usd += source.usd;
    } else {
      bySymbol.set(symbol, {
        symbol,
        name: displayName(symbol),
        usd: source.usd,
        productAsset: symbolToProductAsset(symbol),
      });
    }
  }

  return [...bySymbol.values()].sort((a, b) => b.usd - a.usd);
}

function displayName(symbol: string): string {
  return DISPLAY_NAMES[symbol.toUpperCase()] ?? symbol;
}

function pctChangeFromSeries(series: number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

type AssetListProps = {
  sources: BalanceSource[];
  totalUsd: number;
};

export function AssetList({ sources, totalUsd }: AssetListProps) {
  const [tab, setTab] = useState<AssetTab>("coins");
  const { tokenForAsset, loading: tokensLoading } = useLiFiTokens();
  const assets = useMemo(() => aggregateSources(sources), [sources]);
  // Chart % change keyed by product asset (history depends on the asset, not
  // on the held USD amount) so a balance refresh doesn't refetch unchanged data.
  const assetKey = useMemo(
    () => [...new Set(assets.map((a) => a.productAsset))].join(","),
    [assets],
  );
  const [changes, setChanges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!assetKey) return;
    let cancelled = false;
    const load = async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        assetKey.split(",").map(async (product) => {
          try {
            const res = await fetch(`/api/market/chart?asset=${product}`);
            const data = (await res.json()) as { series?: number[] };
            if (Array.isArray(data.series)) {
              const pct = pctChangeFromSeries(data.series);
              if (pct != null) next[product] = pct;
            }
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled) setChanges(next);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [assetKey]);

  const tabs: { id: AssetTab; label: string }[] = [
    { id: "coins", label: "Coins" },
    { id: "collectibles", label: "Collectibles" },
    { id: "orders", label: "Orders" },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between border-b border-zinc-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`border-b-2 pb-3 text-sm font-semibold transition ${
                tab === t.id
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1 text-sm text-zinc-400">
          All Networks
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </div>

      {tab !== "coins" ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          No {tab} yet.
        </p>
      ) : assets.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          No assets yet — deposit to get started.
        </p>
      ) : (
        <div className="mt-2">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-2 py-3 text-xs font-medium uppercase tracking-wider text-zinc-400 max-md:hidden">
            <span>Asset</span>
            <span className="w-28 text-right">Balance</span>
            <span className="w-20 text-right">Portfolio</span>
            <span className="w-24 text-right">Price</span>
          </div>
          {assets.map((asset) => {
            const token = tokenForAsset(asset.productAsset);
            const price = token?.priceUSD ?? null;
            const amount =
              price != null && price > 0 ? asset.usd / price : null;
            const portfolioPct =
              totalUsd > 0 ? (asset.usd / totalUsd) * 100 : 0;
            const change24h = changes[asset.productAsset] ?? null;

            return (
              <AssetRow
                key={asset.symbol}
                symbol={asset.symbol}
                name={token?.name ?? asset.name}
                logoUri={token?.logoURI}
                balanceUsd={asset.usd}
                amount={amount}
                portfolioPct={portfolioPct}
                priceUsd={price}
                change24h={change24h}
                loading={tokensLoading}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
