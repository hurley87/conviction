"use client";

// Single conviction card — feed-only token/chart vocabulary (issue #4).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import { TokenChip } from "@/components/token-chip";
import { formatUsd, formatTimestamp } from "@/lib/format";
import type { ConvictionEntry } from "@/lib/verbs/types";

type ConvictionCardProps = {
  entry: ConvictionEntry;
};

export function ConvictionCard({ entry }: ConvictionCardProps) {
  const [series, setSeries] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/market/chart?asset=${entry.trade.toAsset}`)
      .then((r) => r.json())
      .then((data: { series?: number[] }) => {
        if (!cancelled && Array.isArray(data.series)) {
          setSeries(data.series);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.trade.toAsset]);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-left backdrop-blur">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">@{entry.handle}</p>
          <p className="mt-1 text-xs text-[#6b7099]">
            {formatTimestamp(entry.createdAt)}
          </p>
        </div>
        <Sparkline series={series} />
      </header>

      <p className="mt-4 text-sm leading-relaxed text-[#d8dcf5]">
        {entry.thesis}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
        <TokenChip asset={entry.trade.toAsset} />
        <p className="text-xs text-[#6b7099]">
          {formatUsd(entry.trade.sizeUsd)} position
        </p>
      </div>

      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="mt-3 inline-block text-xs text-[#6C7BFF] hover:underline"
        >
          View receipt
        </Link>
      )}
    </article>
  );
}
