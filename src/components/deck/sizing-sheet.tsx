"use client";

// Sizing sheet for a right-swipe back — preset fractions of unified balance,
// dollars only, no chain vocabulary (ADR 0003 / 0016). Zero balance never
// reaches this sheet (issue #26 routes to AddMoneySheet instead).

import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { formatUsd } from "@/lib/format";
import {
  DECK_SIZE_FRACTIONS,
  fractionChipLabel,
  sizeUsdForFraction,
} from "@/lib/verbs/deck";
import { DEFAULT_COPY_FRACTION } from "@/lib/verbs/copy";
import type { UniversalBalance } from "@/lib/verbs/types";

export function SizingSheet({
  balance,
  selectedFraction,
  onSelectFraction,
  onContinue,
  onCancel,
  quoting,
}: {
  balance: UniversalBalance | null;
  selectedFraction: number;
  onSelectFraction: (fraction: number) => void;
  onContinue: () => void;
  onCancel: () => void;
  quoting?: boolean;
}) {
  const totalUsd = balance?.totalUsd ?? 0;
  // Hard guard: never render $0 preset rows if balance is missing/empty.
  if (!balance || totalUsd <= 0) return null;

  const dollars = sizeUsdForFraction(balance, selectedFraction);

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-5 text-left">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">
        Size your back
      </p>
      <p className="mt-2 text-sm text-zinc-500">
        Fraction of your balance · dollars only
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {DECK_SIZE_FRACTIONS.map((fraction) => {
          const chip = fractionChipLabel(balance, fraction);
          const selected = fraction === selectedFraction;
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => onSelectFraction(fraction)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "bg-blue-600 text-white"
                  : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {chip.pct}
              <span className="ml-1.5 tabular-nums opacity-80">
                {formatUsd(chip.usd)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-3xl font-semibold tabular-nums text-zinc-900">
        {formatUsd(dollars)}
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        {selectedFraction === DEFAULT_COPY_FRACTION
          ? "Default size"
          : "Custom size"}{" "}
        · balance {formatUsd(totalUsd)}
      </p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onContinue}
          disabled={quoting || dollars <= 0}
          className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
        >
          {quoting ? "Getting quote…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={quoting}
          className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
