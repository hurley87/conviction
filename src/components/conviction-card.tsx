"use client";

// Single conviction card — feed-only token/chart vocabulary (issue #4),
// one-tap back affordance (issue #5).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/sparkline";
import { TokenChip } from "@/components/token-chip";
import { PRIMARY, GHOST } from "@/components/button-styles";
import { formatUsd, formatTimestamp } from "@/lib/format";
import {
  COPY_TRADE_CAP_USD,
  DEFAULT_COPY_FRACTION,
} from "@/lib/verbs/copy";
import type { BackerApi } from "@/hooks/use-backer";
import type { ConvictionEntry } from "@/lib/verbs/types";

type ConvictionCardProps = {
  entry: ConvictionEntry;
  backer: BackerApi;
};

function BackedByList({ handles }: { handles: string[] }) {
  if (handles.length === 0) return null;
  return (
    <p className="mt-3 text-xs text-[#6b7099]">
      Backed by{" "}
      {handles.map((h, i) => (
        <span key={h}>
          {i > 0 && (i === handles.length - 1 ? " and " : ", ")}
          <span className="text-[#aeb4d6]">@{h}</span>
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
    <div className="mt-4 border-t border-white/5 pt-4">
      <BackedByList handles={state.backedBy} />

      {state.receipt && (
        <Link
          href={`/r/${state.receipt.slug}`}
          className="mt-2 inline-block text-xs text-[#6C7BFF] hover:underline"
        >
          View your back receipt
        </Link>
      )}

      {state.error && (
        <p className="mt-2 text-xs text-[#f8728b]">{state.error}</p>
      )}

      {!hasBacked && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleBack()}
              disabled={isBacking}
              className={`${PRIMARY} px-5 py-2 text-sm`}
            >
              {isBacking ? "Backing…" : "Back this"}
            </button>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              disabled={isBacking}
              className={`${GHOST} px-4 py-2 text-xs`}
            >
              {advancedOpen ? "Hide" : "Advanced"}
            </button>
          </div>
          <p className="text-xs text-[#4a4f74]">
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
                disabled={isBacking}
                className="w-36 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-[#4a4f74] focus:border-[#6C7BFF]/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isBacking || !overrideInput}
                className={`${GHOST} px-4 py-2 text-xs`}
              >
                Back custom amount
              </button>
            </form>
          )}
        </div>
      )}

      {hasBacked && state.phase !== "backing" && (
        <p className="mt-3 text-xs text-[#37E0C8]">You backed this conviction.</p>
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

      <BackButton entry={entry} backer={backer} />
    </article>
  );
}
