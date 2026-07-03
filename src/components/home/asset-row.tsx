"use client";

import { formatUsd } from "@/lib/format";

type AssetRowProps = {
  symbol: string;
  name: string;
  logoUri?: string;
  balanceUsd: number;
  amount: number | null;
  portfolioPct: number;
  priceUsd: number | null;
  change24h: number | null;
  loading?: boolean;
};

function formatAmount(n: number, symbol: string): string {
  const decimals = symbol === "USDC" || symbol === "USDT" ? 2 : 4;
  return `${n.toFixed(decimals)} ${symbol}`;
}

export function AssetRow({
  symbol,
  name,
  logoUri,
  balanceUsd,
  amount,
  portfolioPct,
  priceUsd,
  change24h,
  loading,
}: AssetRowProps) {
  const isNegative = change24h != null && change24h < 0;

  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-zinc-100 px-2 py-4 transition hover:bg-zinc-50 md:grid-cols-[1fr_auto_auto_auto] md:gap-4">
      <div className="flex items-center gap-3">
        {logoUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUri} alt="" width={40} height={40} className="rounded-full" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold uppercase text-zinc-500">
            {symbol.slice(0, 3)}
          </span>
        )}
        <div>
          <p className="font-semibold text-zinc-900">{name}</p>
          <p className="text-sm text-zinc-400">{symbol}</p>
        </div>
      </div>

      <div className="md:w-28 md:text-right">
        <p className="font-semibold tabular-nums text-zinc-900">{formatUsd(balanceUsd)}</p>
        {amount != null && (
          <p className="text-sm tabular-nums text-zinc-400">
            {formatAmount(amount, symbol)}
          </p>
        )}
      </div>

      <div className="hidden text-right text-sm tabular-nums text-zinc-600 md:block md:w-20">
        {portfolioPct.toFixed(1)}%
      </div>

      <div className="md:w-24 md:text-right">
        {loading ? (
          <p className="text-sm text-zinc-300">…</p>
        ) : priceUsd != null ? (
          <>
            <p className="text-sm tabular-nums text-zinc-900">{formatUsd(priceUsd)}</p>
            {change24h != null && (
              <p
                className={`text-xs tabular-nums ${
                  isNegative ? "text-red-500" : "text-emerald-600"
                }`}
              >
                {isNegative ? "" : "+"}
                {change24h.toFixed(2)}%
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-zinc-400">—</p>
        )}
      </div>
    </div>
  );
}
