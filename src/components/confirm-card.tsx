// Jargon-free confirm card (ADR 0011). Dollars in → dollars out, fee, ETA.
// No chain/token vocabulary — explicit human confirmation required.

import { formatEta } from "@/lib/verbs/quote";
import { formatUsd } from "@/lib/format";
import type { TradeQuote } from "@/lib/verbs/types";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";

export function ConfirmCard({
  quote,
  executing,
  onConfirm,
  onCancel,
}: {
  quote: TradeQuote;
  executing?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Confirm your move
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-zinc-500">You&apos;re spending</span>
          <span className="text-xl font-semibold tabular-nums text-zinc-900">
            {formatUsd(quote.dollarsIn)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-zinc-500">You&apos;ll get</span>
          <span className="text-xl font-semibold tabular-nums text-emerald-600">
            ≈{formatUsd(quote.dollarsOut)} in cash
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3">
          <span className="text-sm text-zinc-500">Fee</span>
          <span className="text-sm tabular-nums text-zinc-600">
            {formatUsd(quote.feeUsd)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-zinc-500">ETA</span>
          <span className="text-sm text-zinc-600">
            {formatEta(quote.etaSeconds)}
          </span>
        </div>
      </div>

      {quote.dollarsIn > 0 && quote.feeUsd / quote.dollarsIn > 0.05 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          Heads up — the fee is {formatUsd(quote.feeUsd)}, about{" "}
          {Math.round((quote.feeUsd / quote.dollarsIn) * 100)}% of this move.
          Larger moves cost proportionally less.
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={executing}
          className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
        >
          {executing ? "Moving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={executing}
          className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
