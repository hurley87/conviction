"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiFiTokens } from "@/hooks/use-lifi-tokens";
import { assetMatches } from "@/lib/verbs/assets";
import type { BalanceSource, ProductAsset } from "@/lib/verbs/types";
import { AssetRow } from "@/components/home/asset-row";
import { MULTI_NETWORK, networkColor } from "@/lib/networks";

type HoldingsTab = "holdings" | "convictions" | "activity";

type AggregatedAsset = {
  symbol: string;
  name: string;
  usd: number;
  productAsset: ProductAsset;
  /** Chain holding the largest USD slice of this symbol. */
  chain: string;
  /** True when the symbol is spread across more than one chain. */
  multiChain: boolean;
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

function displayName(symbol: string): string {
  return DISPLAY_NAMES[symbol.toUpperCase()] ?? symbol;
}

/** Per-symbol accumulator; the dominant chain + multiChain flag are derived once
 * at the end from `chains` rather than seeded and overwritten. */
type SymbolAcc = {
  symbol: string;
  name: string;
  usd: number;
  productAsset: ProductAsset;
  chains: Map<string, number>;
};

function aggregateSources(sources: BalanceSource[]): AggregatedAsset[] {
  const bySymbol = new Map<string, SymbolAcc>();

  for (const source of sources) {
    const symbol = source.asset.toUpperCase();
    const existing = bySymbol.get(symbol);
    if (existing) {
      existing.usd += source.usd;
      existing.chains.set(
        source.chain,
        (existing.chains.get(source.chain) ?? 0) + source.usd,
      );
    } else {
      bySymbol.set(symbol, {
        symbol,
        name: displayName(symbol),
        usd: source.usd,
        productAsset: symbolToProductAsset(symbol),
        chains: new Map([[source.chain, source.usd]]),
      });
    }
  }

  return [...bySymbol.values()]
    .map(({ chains, ...asset }) => {
      // Dominant chain = the one holding the most USD of this symbol.
      const dominant = [...chains.entries()].sort((a, b) => b[1] - a[1])[0]!;
      return { ...asset, chain: dominant[0], multiChain: chains.size > 1 };
    })
    .sort((a, b) => b.usd - a.usd);
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
};

export function AssetList({ sources }: AssetListProps) {
  const [tab, setTab] = useState<HoldingsTab>("holdings");
  const { tokenForAsset, loading: tokensLoading } = useLiFiTokens();
  const assets = useMemo(() => aggregateSources(sources), [sources]);
  // 30d change keyed by product asset (history depends on the asset, not on the
  // held USD amount) so a balance refresh doesn't refetch unchanged data.
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

  // Distinct networks present — stacked into the "All networks" chip.
  const networkColors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) {
      const key = asset.chain.toLowerCase();
      if (!seen.has(key)) seen.set(key, networkColor(asset.chain));
    }
    return [...seen.values()].slice(0, 4);
  }, [assets]);

  const tabs: { id: HoldingsTab; label: string }[] = [
    { id: "holdings", label: "Holdings" },
    { id: "convictions", label: "My convictions" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center gap-6 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-2.5 text-sm transition ${
              tab === t.id
                ? "border-brand font-bold text-ink"
                : "border-transparent font-semibold text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-2.5 text-[13px] font-bold text-ink-2">
          <span className="flex">
            {networkColors.map((color, i) => (
              <span
                key={color}
                className="h-4 w-4 rounded-chip ring-2 ring-canvas"
                style={{
                  background: color,
                  marginLeft: i === 0 ? 0 : -6,
                }}
                aria-hidden
              />
            ))}
          </span>
          All networks
          <svg
            width="14"
            height="14"
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
        </div>
      </div>

      {tab === "convictions" ? (
        <p className="py-12 text-center text-sm text-ink-3">
          Convictions you back will appear here.
        </p>
      ) : tab === "activity" ? (
        <p className="py-12 text-center text-sm text-ink-3">
          Your recent moves will appear here.
        </p>
      ) : assets.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-3">
          No assets yet — deposit to get started.
        </p>
      ) : (
        <div className="mt-5">
          <div className="grid grid-cols-[1fr_150px_140px_90px] gap-4 px-4 pb-2.5 text-[11.5px] font-bold uppercase tracking-[0.04em] text-ink-4 max-md:hidden">
            <span>Asset</span>
            <span>Network</span>
            <span className="text-right">Balance</span>
            <span className="text-right">30d</span>
          </div>
          {assets.map((asset) => {
            const token = tokenForAsset(asset.productAsset);
            const price = token?.priceUSD ?? null;
            const amount = price != null && price > 0 ? asset.usd / price : null;
            const change30d = changes[asset.productAsset] ?? null;
            const meta = asset.multiChain
              ? MULTI_NETWORK
              : { label: asset.chain, color: networkColor(asset.chain) };

            return (
              <AssetRow
                key={asset.symbol}
                symbol={asset.symbol}
                name={token?.name ?? asset.name}
                logoUri={token?.logoURI}
                balanceUsd={asset.usd}
                amount={amount}
                networkLabel={meta.label}
                networkColor={meta.color}
                change30d={change30d}
                loading={tokensLoading}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
