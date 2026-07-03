"use client";

// Token name + logo + spot price — feed-only vocabulary (issue #4).

import { useLiFiTokens } from "@/hooks/use-lifi-tokens";
import { formatUsd } from "@/lib/format";
import type { ProductAsset } from "@/lib/verbs/types";

type TokenChipProps = {
  asset: ProductAsset;
};

export function TokenChip({ asset }: TokenChipProps) {
  const { tokenForAsset, loading } = useLiFiTokens();
  const token = tokenForAsset(asset);

  const label = token?.symbol ?? asset.toUpperCase();
  const name = token?.name ?? label;

  return (
    <div className="flex items-center gap-2">
      {token?.logoURI ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={token.logoURI}
          alt=""
          width={24}
          height={24}
          className="rounded-full"
        />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold uppercase text-zinc-500">
          {label.slice(0, 3)}
        </span>
      )}
      <div className="text-left">
        <p className="text-sm font-semibold text-zinc-900">{name}</p>
        {loading ? (
          <p className="text-xs text-zinc-400">Loading price…</p>
        ) : token?.priceUSD != null ? (
          <p className="text-xs text-zinc-500">{formatUsd(token.priceUSD)}</p>
        ) : (
          <p className="text-xs text-zinc-400">{label}</p>
        )}
      </div>
    </div>
  );
}
