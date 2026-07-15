"use client";

// Single conviction card — feed-only token/chart vocabulary (issue #4),
// one-tap back affordance (issue #5), optional card anatomy (issue #18).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import { TokenChip } from "@/components/token-chip";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { TradePendingStatus } from "@/components/trade-pending";
import { formatUsd, formatTimestamp } from "@/lib/format";
import {
  COPY_TRADE_CAP_USD,
  DEFAULT_COPY_FRACTION,
} from "@/lib/verbs/copy";
import { hasAnatomy } from "@/lib/verbs/conviction";
import type { BackerApi } from "@/hooks/use-backer";
import type { ConvictionEntry, GateCheck, WhyNowEvent } from "@/lib/verbs/types";

type ConvictionCardProps = {
  entry: ConvictionEntry;
  backer: BackerApi;
};

function BackedByList({ handles }: { handles: string[] }) {
  if (handles.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-zinc-400">
      Backed by{" "}
      {handles.map((h, i) => (
        <span key={h}>
          {i > 0 && (i === handles.length - 1 ? " and " : ", ")}
          <span className="text-zinc-600">@{h}</span>
        </span>
      ))}
    </p>
  );
}

function WhyNowList({ events }: { events: WhyNowEvent[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {events.map((e) => (
        <li key={`${e.at}-${e.event}`} className="text-xs text-zinc-600">
          <time className="font-medium text-zinc-800" dateTime={e.at}>
            {formatTimestamp(e.at)}
          </time>
          <span className="text-zinc-400"> — </span>
          {e.event}
        </li>
      ))}
    </ul>
  );
}

function GateReportList({ checks }: { checks: GateCheck[] }) {
  return (
    <ul className="mt-1 space-y-1.5">
      {checks.map((c) => (
        <li
          key={c.id ?? c.name}
          className="flex flex-wrap items-baseline gap-x-2 text-xs text-zinc-600"
        >
          <span
            className={
              c.passed
                ? "font-medium text-emerald-600"
                : "font-medium text-red-500"
            }
          >
            {c.passed ? "Pass" : "Fail"}
          </span>
          <span>{!c.passed && c.detail ? c.detail : c.name}</span>
          {c.evidenceUrl && (
            <a
              href={c.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Evidence
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function CardAnatomy({ entry }: { entry: ConvictionEntry }) {
  if (!hasAnatomy(entry)) return null;

  return (
    <details className="mt-4 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-zinc-500 select-none">
        Card details
      </summary>
      <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3">
        {entry.whyNow && entry.whyNow.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Why now
            </h3>
            <WhyNowList events={entry.whyNow} />
          </section>
        )}
        {entry.whatBreaksIt && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              What breaks it
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              {entry.whatBreaksIt}
            </p>
          </section>
        )}
        {entry.gateReport && entry.gateReport.length > 0 && (
          <section>
            <h3 className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">
              Gate report
            </h3>
            <GateReportList checks={entry.gateReport} />
          </section>
        )}
      </div>
    </details>
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
    <div className="mt-4 border-t border-zinc-100 pt-4">
      <BackedByList handles={state.backedBy} />

      {state.receipt && (
        <Link
          href={`/r/${state.receipt.slug}`}
          className="mt-2 inline-block text-xs text-blue-600 hover:underline"
        >
          View your back receipt
        </Link>
      )}

      {state.error && (
        <p className="mt-2 text-xs text-red-500">{state.error}</p>
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
            <p className="text-xs text-zinc-400">
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
                  className="w-36 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none"
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
        <p className="mt-3 text-xs text-emerald-600">
          You backed this conviction.
        </p>
      )}
    </div>
  );
}

export function ConvictionCard({ entry, backer }: ConvictionCardProps) {
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
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900">@{entry.handle}</p>
          <p className="mt-1 text-xs text-zinc-400">
            {formatTimestamp(entry.createdAt)}
          </p>
        </div>
        <Sparkline series={series} />
      </header>

      <p className="mt-4 text-sm leading-relaxed text-zinc-700">
        {entry.thesis}
      </p>

      <CardAnatomy entry={entry} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <TokenChip asset={entry.trade.toAsset} />
        <p className="text-xs text-zinc-400">
          {formatUsd(entry.trade.sizeUsd)} position
        </p>
      </div>

      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="mt-3 inline-block text-xs text-blue-600 hover:underline"
        >
          View receipt
        </Link>
      )}

      <BackButton entry={entry} backer={backer} />
    </article>
  );
}
