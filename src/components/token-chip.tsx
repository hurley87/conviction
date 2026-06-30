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
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold uppercase text-[#aeb4d6]">
          {label.slice(0, 3)}
        </span>
      )}
      <div className="text-left">
        <p className="text-sm font-semibold text-white">{name}</p>
        {loading ? (
          <p className="text-xs text-[#6b7099]">Loading price…</p>
        ) : token?.priceUSD != null ? (
          <p className="text-xs text-[#aeb4d6]">{formatUsd(token.priceUSD)}</p>
        ) : (
          <p className="text-xs text-[#6b7099]">{label}</p>
        )}
      </div>
    </div>
  );
}
