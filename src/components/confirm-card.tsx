// Jargon-free confirm card (ADR 0011). Dollars in → dollars out, fee, ETA.
// No chain/token vocabulary — explicit human confirmation required.

import { formatEta } from "@/lib/verbs/quote";
import { formatUsd } from "@/lib/format";
import type { TradeQuote } from "@/lib/verbs/types";
import { PRIMARY, GHOST } from "@/components/button-styles";

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
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#6b7099]">
        Confirm your move
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#aeb4d6]">You&apos;re spending</span>
          <span className="text-xl font-semibold tabular-nums text-white">
            {formatUsd(quote.dollarsIn)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#aeb4d6]">You&apos;ll get</span>
          <span className="text-xl font-semibold tabular-nums text-[#37E0C8]">
            ≈{formatUsd(quote.dollarsOut)} in cash
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-white/5 pt-3">
          <span className="text-sm text-[#aeb4d6]">Fee</span>
          <span className="text-sm tabular-nums text-[#aeb4d6]">
            {formatUsd(quote.feeUsd)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#aeb4d6]">ETA</span>
          <span className="text-sm text-[#aeb4d6]">
            {formatEta(quote.etaSeconds)}
          </span>
        </div>
      </div>

      {quote.dollarsIn > 0 && quote.feeUsd / quote.dollarsIn > 0.05 && (
        <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200/90">
          Heads up — the fee is {formatUsd(quote.feeUsd)}, about{" "}
          {Math.round((quote.feeUsd / quote.dollarsIn) * 100)}% of this move.
          Larger moves cost proportionally less.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          disabled={executing}
          className={PRIMARY}
        >
          {executing ? "Moving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={executing}
          className={GHOST}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
