// Jargon-free confirm card (ADR 0011). Dollars in → dollars out, fee, ETA.
// No chain vocabulary — destination named only as cash or a ticker. Explicit
// human confirmation required.

import { formatEta } from "@/lib/verbs/quote";
import { formatUsd } from "@/lib/format";
import { productAssetPrimarySymbol } from "@/lib/verbs/assets";
import type { TradeQuote } from "@/lib/verbs/types";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { TradePendingStatus } from "@/components/trade-pending";

function destinationLabel(quote: TradeQuote): string {
  if (quote.toAsset === "cash") return "cash";
  return quote.receivedSymbol ?? productAssetPrimarySymbol(quote.toAsset);
}

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
    <div className="w-full rounded-[26px] border border-line bg-surface p-5 text-left shadow-lg">
      <p className="pt-eyebrow">
        Confirm your move
      </p>

      <div className="mt-4 space-y-2">
        <div className="rounded-[18px] bg-surface-2 p-4">
          <span className="text-xs font-bold text-ink-4">You&apos;re spending</span>
          <span className="mt-1 block font-display text-3xl font-semibold tabular-nums text-ink">
            {formatUsd(quote.dollarsIn)}
          </span>
        </div>
        <div className="rounded-[18px] bg-[#edf6e9] p-4">
          <span className="text-xs font-bold text-success">You&apos;ll get</span>
          <span className="mt-1 block font-display text-3xl font-semibold tabular-nums text-success">
            ≈{formatUsd(quote.dollarsOut)} in {destinationLabel(quote)}
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm text-ink-3">Fee</span>
          <span className="text-sm tabular-nums text-ink-2">
            {formatUsd(quote.feeUsd)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-3">ETA</span>
          <span className="text-sm text-ink-2">
            {formatEta(quote.etaSeconds)}
          </span>
        </div>
      </div>

      {quote.dollarsIn > 0 && quote.feeUsd / quote.dollarsIn > 0.05 && (
        <div className="mt-4 rounded-[16px] border border-warning/25 bg-[#fff6df] p-3 text-xs leading-relaxed text-warning">
          Heads up — the fee is {formatUsd(quote.feeUsd)}, about{" "}
          {Math.round((quote.feeUsd / quote.dollarsIn) * 100)}% of this move.
          Larger moves cost proportionally less.
        </div>
      )}

      {executing ? (
        <div className="mt-5">
          <TradePendingStatus />
        </div>
      ) : (
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
