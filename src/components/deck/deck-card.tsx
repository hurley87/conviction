"use client";

// Full-anatomy card face for the home deck (ADR 0016). No chain names.

import Link from "next/link";
import { CardAnatomy } from "@/components/card-anatomy";
import { TokenChip } from "@/components/token-chip";
import { formatUsd, formatTimestamp } from "@/lib/format";
import type { ConvictionEntry } from "@/lib/verbs/types";

export function DeckCard({ entry }: { entry: ConvictionEntry }) {
  const initial = entry.handle.slice(0, 1).toUpperCase();

  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-[30px] border border-line bg-surface/95 p-5 text-left shadow-[0_28px_70px_rgba(75,42,82,0.16)] backdrop-blur-md sm:p-6">
      <div
        className="pointer-events-none absolute -right-20 -top-28 h-64 w-72 rounded-full opacity-45 blur-[55px]"
        style={{ background: "var(--pt-grad-dawn)" }}
        aria-hidden
      />
      <header className="relative flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-display text-lg font-bold text-ink"
          style={{ background: "var(--pt-mood-sad)" }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-extrabold text-ink">@{entry.handle}</p>
            {entry.authorship?.authorKind === "agent" && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] font-extrabold tracking-[0.1em] text-ink-3 uppercase">
                Agent
              </span>
            )}
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] text-brand">
              Revealed
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-4">
            {entry.authorship?.authorKind === "agent"
              ? `Agent · operated by @${entry.authorship.operatorHandle} · ${formatTimestamp(entry.createdAt)}`
              : formatTimestamp(entry.createdAt)}
          </p>
        </div>
      </header>

      <p className="pt-eyebrow relative mt-6">The thesis</p>
      <p className="relative mt-2 font-display text-[clamp(1.35rem,3vw,1.7rem)] font-medium leading-[1.25] tracking-[-0.02em] text-ink">
        {entry.thesis}
      </p>

      <div className="relative mt-1 flex-1 overflow-y-auto pr-1">
        <CardAnatomy entry={entry} defaultOpen />
      </div>

      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <TokenChip asset={entry.trade.toAsset} token={entry.trade.token} />
        <p className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-bold text-ink-3">
          {formatUsd(entry.trade.sizeUsd)} position
        </p>
      </div>

      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="relative mt-3 inline-block text-xs font-bold text-brand underline-offset-4 hover:underline"
        >
          View desk receipt
        </Link>
      )}

      <p className="relative mt-4 text-center text-[10px] font-bold tracking-[0.13em] text-ink-4 uppercase">
        Skip left · save up · back right
      </p>
    </article>
  );
}
