"use client";

import { formatUsd } from "@/lib/format";

type AssetRowProps = {
  symbol: string;
  name: string;
  logoUri?: string;
  balanceUsd: number;
  amount: number | null;
  /** Network badge label, e.g. "Base" (or "Multiple" when spread). */
  networkLabel: string;
  /** Network badge swatch color. */
  networkColor: string;
  /** 30-day price change, %. */
  change30d: number | null;
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
  networkLabel,
  networkColor,
  change30d,
  loading,
}: AssetRowProps) {
  const isNegative = change30d != null && change30d < 0;

  return (
    <div className="mb-2 grid grid-cols-1 items-center gap-3 rounded-[18px] border border-transparent bg-surface-2/65 px-4 py-3.5 transition hover:border-line hover:bg-surface hover:shadow-sm md:grid-cols-[1fr_150px_140px_90px] md:gap-4">
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9">
          {logoUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUri}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold uppercase text-ink">
              {symbol.slice(0, 1)}
            </span>
          )}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-[15px] w-[15px] rounded-chip border-2 border-surface"
            style={{ background: networkColor }}
            aria-hidden
          />
        </div>
        <div>
          <p className="text-sm font-bold text-ink">{name}</p>
          <p className="text-xs text-ink-4">{symbol}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2 max-md:hidden">
        <span
          className="h-4 w-4 rounded-chip"
          style={{ background: networkColor }}
          aria-hidden
        />
        {networkLabel}
      </div>

      <div className="md:text-right">
        <p className="text-sm font-bold tabular-nums text-ink">
          {formatUsd(balanceUsd)}
        </p>
        {amount != null && (
          <p className="text-xs tabular-nums text-ink-4">
            {formatAmount(amount, symbol)}
          </p>
        )}
      </div>

      <div className="md:text-right">
        {loading ? (
          <p className="text-sm text-ink-4">…</p>
        ) : change30d != null ? (
          <p
            className={`text-[13px] font-bold tabular-nums ${
              isNegative ? "text-danger" : "text-success"
            }`}
          >
            {isNegative ? "−" : "+"}
            {Math.abs(change30d).toFixed(1)}%
          </p>
        ) : (
          <p className="text-[13px] font-semibold tabular-nums text-ink-4">
            0.0%
          </p>
        )}
      </div>
    </div>
  );
}
