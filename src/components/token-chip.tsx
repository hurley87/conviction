"use client";

// Token name + logo + spot price — feed-only vocabulary (issue #4).
// Concrete TokenRef cards show the token symbol directly (no chain name).

import { useLiFiTokens } from "@/hooks/use-lifi-tokens";
import { formatUsd } from "@/lib/format";
import type { ProductAsset, TokenRef } from "@/lib/verbs/types";

type TokenChipProps = {
  asset: ProductAsset;
  /** When set (deck TokenRef cards), prefer this symbol over product lookup. */
  token?: TokenRef;
};

export function TokenChip({ asset, token }: TokenChipProps) {
  const { tokenForAsset, loading } = useLiFiTokens();
  const product = tokenForAsset(asset);

  const label = token?.symbol ?? product?.symbol ?? asset.toUpperCase();
  const name = token?.symbol ?? product?.name ?? label;

  return (
    <div className="flex items-center gap-2">
      {!token && product?.logoURI ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.logoURI}
          alt=""
          width={24}
          height={24}
          className="rounded-full"
        />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-[9px] font-extrabold uppercase text-brand">
          {label.slice(0, 3)}
        </span>
      )}
      <div className="text-left">
        <p className="text-sm font-extrabold text-ink">{name}</p>
        {token ? (
          <p className="text-xs text-ink-4">{label}</p>
        ) : loading ? (
          <p className="text-xs text-ink-4">Loading price…</p>
        ) : product?.priceUSD != null ? (
          <p className="text-xs text-ink-3">{formatUsd(product.priceUSD)}</p>
        ) : (
          <p className="text-xs text-ink-4">{label}</p>
        )}
      </div>
    </div>
  );
}
