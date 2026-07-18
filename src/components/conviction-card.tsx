"use client";

// Single conviction card — feed-only token/chart vocabulary (issue #4),
// one-tap back affordance (issue #5), optional card anatomy (issue #18).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import { TokenChip } from "@/components/token-chip";
import { CardAnatomy } from "@/components/card-anatomy";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { TradePendingStatus } from "@/components/trade-pending";
import { formatUsd, formatTimestamp } from "@/lib/format";
import {
  COPY_TRADE_CAP_USD,
  DEFAULT_COPY_FRACTION,
} from "@/lib/verbs/copy";
import type { BackerApi } from "@/hooks/use-backer";
import type { BackerAttribution, ConvictionEntry } from "@/lib/verbs/types";

type ConvictionCardProps = {
  entry: ConvictionEntry;
  backer: BackerApi;
  /** Marked via deck save verb (issue #24). */
  saved?: boolean;
};

function BackedByList({
  entry,
}: {
  entry: ConvictionEntry;
}) {
  const backers: BackerAttribution[] =
    entry.backerAttributions ??
    entry.backedBy.map((handle) => ({ handle }));
  if (backers.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-ink-4">
      Backed by{" "}
      {backers.map((backer, i) => (
        <span key={backer.handle}>
          {i > 0 && (i === backers.length - 1 ? " and " : ", ")}
          <span className="font-bold text-ink-2">@{backer.handle}</span>
          {backer.authorship?.authorKind === "agent" && (
            <span className="text-ink-4">
              {" "}
              (Agent
              {backer.authorship.operatorHandle
                ? ` · operated by @${backer.authorship.operatorHandle}`
                : ""}
              )
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

function BackButton({
  entry,
  backer,
}: {
  entry: ConvictionEntry;
  backer: BackerApi;
}) {
  const state = backer.getEntryState(entry);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overrideInput, setOverrideInput] = useState("");

  const defaultPct = Math.round(DEFAULT_COPY_FRACTION * 100);
  const isBacking = state.phase === "backing";
  const hasBacked =
    state.phase === "backed" ||
    (backer.handle != null && state.backedBy.includes(backer.handle));

  const handleBack = (override?: number) => {
    void backer.back(entry, override);
  };

  return (
    <div className="mt-5 border-t border-line pt-4">
      <BackedByList
        entry={{
          ...entry,
          backedBy: state.backedBy,
          ...(entry.backerAttributions
            ? { backerAttributions: entry.backerAttributions }
            : {}),
        }}
      />

      {state.receipt && (
        <Link
          href={`/r/${state.receipt.slug}`}
          className="mt-2 inline-block text-xs font-bold text-brand underline-offset-4 hover:underline"
        >
          View your back receipt
        </Link>
      )}

      {state.error && (
        <p className="mt-2 text-xs text-danger">{state.error}</p>
      )}

      {!hasBacked &&
        (isBacking ? (
          <div className="mt-3">
            <TradePendingStatus />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleBack()}
                className={`${PRIMARY_LIGHT} px-5 py-2 text-sm`}
              >
                Back this
              </button>
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className={`${GHOST_LIGHT} px-4 py-2 text-xs`}
              >
                {advancedOpen ? "Hide" : "Advanced"}
              </button>
            </div>
            <p className="text-xs leading-relaxed text-ink-4">
              Mirrors this trade at {defaultPct}% of your balance (up to{" "}
              {formatUsd(COPY_TRADE_CAP_USD)}).
            </p>

            {advancedOpen && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseFloat(overrideInput);
                  if (Number.isFinite(n) && n > 0) handleBack(n);
                }}
              >
                <input
                  type="number"
                  min={0.01}
                  max={COPY_TRADE_CAP_USD}
                  step={0.01}
                  value={overrideInput}
                  onChange={(e) => setOverrideInput(e.target.value)}
                  placeholder="Custom amount ($)"
                  className="app-input w-40 rounded-full px-4 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={!overrideInput}
                  className={`${GHOST_LIGHT} px-4 py-2 text-xs`}
                >
                  Back custom amount
                </button>
              </form>
            )}
          </div>
        ))}

      {hasBacked && state.phase !== "backing" && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1.5 text-xs font-bold text-success">
          <span>✓</span> You backed this conviction.
        </p>
      )}
    </div>
  );
}

export function ConvictionCard({ entry, backer, saved = false }: ConvictionCardProps) {
  const [series, setSeries] = useState<number[]>([]);
  const initial = entry.handle.slice(0, 1).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    const assetParam = entry.trade.token?.symbol ?? entry.trade.toAsset;
    void fetch(`/api/market/chart?asset=${assetParam}`)
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
  }, [entry.trade.toAsset, entry.trade.token?.symbol]);

  return (
    <article className="app-card app-card-interactive relative overflow-hidden p-5 text-left sm:p-6">
      <div
        className="pointer-events-none absolute -right-28 -top-36 h-72 w-80 rounded-full opacity-25 blur-[70px]"
        style={{ background: "var(--pt-grad-dawn)" }}
        aria-hidden
      />
      <header className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-base font-bold text-ink"
            style={{ background: "var(--pt-mood-sad)" }}
          >
            {initial}
          </span>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-extrabold text-ink">@{entry.handle}</p>
            {entry.authorship?.authorKind === "agent" && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[9px] font-extrabold tracking-[0.1em] text-ink-3 uppercase">
                Agent
              </span>
            )}
            {saved && (
              <span className="rounded-full bg-[#fff1c9] px-2 py-0.5 text-[9px] font-extrabold tracking-[0.1em] text-warning uppercase">
                ↑ Saved
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-4">
            {entry.authorship?.authorKind === "agent"
              ? `Agent · operated by @${entry.authorship.operatorHandle} · ${formatTimestamp(entry.createdAt)}`
              : formatTimestamp(entry.createdAt)}
          </p>
          </div>
        </div>
        <Sparkline series={series} />
      </header>

      <p className="pt-eyebrow relative mt-6">The thesis</p>
      <p className="relative mt-2 font-display text-[1.45rem] font-medium leading-[1.35] tracking-[-0.018em] text-ink">
        {entry.thesis}
      </p>

      <div className="relative">
        <CardAnatomy entry={entry} />
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
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
          View receipt
        </Link>
      )}

      <BackButton entry={entry} backer={backer} />
    </article>
  );
}
