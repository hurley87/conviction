"use client";

// Full-anatomy card face for the home deck (ADR 0016). No chain names.

import Link from "next/link";
import { CardAnatomy } from "@/components/card-anatomy";
import { TokenChip } from "@/components/token-chip";
import { formatUsd, formatTimestamp } from "@/lib/format";
import type { ConvictionEntry } from "@/lib/verbs/types";

export function DeckCard({ entry }: { entry: ConvictionEntry }) {
  return (
    <article className="flex h-full flex-col rounded-3xl border border-zinc-200 bg-white p-6 text-left shadow-lg">
      <header>
        <p className="text-sm font-semibold text-zinc-900">@{entry.handle}</p>
        <p className="mt-1 text-xs text-zinc-400">
          {formatTimestamp(entry.createdAt)}
        </p>
      </header>

      <p className="mt-5 text-base leading-relaxed text-zinc-800">
        {entry.thesis}
      </p>

      <div className="mt-2 flex-1 overflow-y-auto">
        <CardAnatomy entry={entry} defaultOpen />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <TokenChip asset={entry.trade.toAsset} token={entry.trade.token} />
        <p className="text-xs text-zinc-400">
          {formatUsd(entry.trade.sizeUsd)} position
        </p>
      </div>

      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="mt-3 inline-block text-xs text-blue-600 hover:underline"
        >
          View desk receipt
        </Link>
      )}

      <p className="mt-5 text-center text-[11px] tracking-wide text-zinc-400 uppercase">
        Skip left · save up · back right
      </p>
    </article>
  );
}
