"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiFiTokens } from "@/hooks/use-lifi-tokens";
import { assetMatches } from "@/lib/verbs/assets";
import type { BalanceSource, ProductAsset } from "@/lib/verbs/types";
import { AssetRow } from "@/components/home/asset-row";
import { NetworkFilter } from "@/components/home/network-filter";
import { MULTI_NETWORK, networkColor } from "@/lib/networks";

type HoldingsTab = "holdings" | "convictions";

type AggregatedAsset = {
  symbol: string;
  name: string;
  usd: number;
  productAsset: ProductAsset;
  /** Chain holding the largest USD slice of this symbol. */
  chain: string;
  /** Per-network slices, largest first. */
  networks: { chain: string; usd: number }[];
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
      const networks = [...chains.entries()]
        .map(([chain, usd]) => ({ chain, usd }))
        .sort((a, b) => b.usd - a.usd);
      return { ...asset, chain: networks[0]!.chain, networks };
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
  const [selectedNetwork, setSelectedNetwork] = useState("all");
  const { tokenForAsset, loading: tokensLoading } = useLiFiTokens();
  const networks = useMemo(
    () =>
      [...new Set(sources.map((source) => source.chain))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [sources],
  );
  const networkTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const source of sources) {
      totals[source.chain] = (totals[source.chain] ?? 0) + source.usd;
    }
    return totals;
  }, [sources]);
  const activeNetwork =
    selectedNetwork === "all" || networks.includes(selectedNetwork)
      ? selectedNetwork
      : "all";
  const filteredSources = useMemo(
    () =>
      activeNetwork === "all"
        ? sources
        : sources.filter((source) => source.chain === activeNetwork),
    [activeNetwork, sources],
  );
  const assets = useMemo(
    () => aggregateSources(filteredSources),
    [filteredSources],
  );
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

  const tabs: { id: HoldingsTab; label: string }[] = [
    { id: "holdings", label: "Holdings" },
    { id: "convictions", label: "My convictions" },
  ];

  return (
    <div className="app-card relative w-full overflow-visible p-4 sm:p-6">
      <div className="flex items-end gap-4 border-b border-line">
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 border-b-2 pb-3 text-sm transition ${
                tab === t.id
                  ? "border-brand font-bold text-ink"
                  : "border-transparent font-semibold text-ink-3 hover:text-ink-2"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <NetworkFilter
          networks={networks}
          networkTotals={networkTotals}
          value={activeNetwork}
          onChange={setSelectedNetwork}
        />
      </div>

      {tab === "convictions" ? (
        <p className="py-12 text-center text-sm text-ink-3">
          Convictions you back will appear here.
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
            const multiChain = asset.networks.length > 1;
            const meta = multiChain
              ? MULTI_NETWORK
              : { label: asset.chain, color: networkColor(asset.chain) };
            const networkBreakdown = multiChain
              ? asset.networks.map((network) => ({
                  ...network,
                  color: networkColor(network.chain),
                  amount:
                    price != null && price > 0 ? network.usd / price : null,
                }))
              : undefined;

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
                networkBreakdown={networkBreakdown}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
