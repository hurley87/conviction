// Opt-in receipt surface — the only place chain names and explorer links
// appear in the UI (ADR 0013).

import type { Receipt } from "@/lib/verbs/types";
import { formatUsd } from "@/lib/format";
import { GHOST_LIGHT } from "@/components/button-styles";

export function ReceiptView({
  receipt,
  permalink,
  onDismiss,
}: {
  receipt: Receipt;
  permalink?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="w-full rounded-[26px] border border-line bg-surface p-5 text-left shadow-lg">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#e5f1df] text-success">✓</span>
        <p className="pt-eyebrow">Receipt</p>
      </div>

      <p className="mt-4 font-display text-xl font-medium leading-relaxed text-ink">{receipt.summary}</p>

      <dl className="mt-4 space-y-2 rounded-[18px] bg-surface-2 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-3">Spent</dt>
          <dd className="font-bold tabular-nums text-ink">
            {formatUsd(receipt.dollarsIn)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Received</dt>
          <dd className="font-bold tabular-nums text-success">
            {formatUsd(receipt.dollarsOut)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Fee</dt>
          <dd className="tabular-nums text-ink-2">
            {formatUsd(receipt.feeUsd)}
          </dd>
        </div>
      </dl>

      {receipt.legs.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-4">
          {receipt.legs.map((leg) => (
            <li key={`${leg.chain}-${leg.txHash}`} className="text-sm">
              <span className="font-bold text-ink">{leg.chain}</span>
              {" · "}
              <a
                href={leg.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-brand underline-offset-2 hover:underline"
              >
                View on explorer
              </a>
            </li>
          ))}
        </ul>
      )}

      {permalink && (
        <p className="mt-4 break-all text-xs text-ink-3">
          Share:{" "}
          <a
            href={permalink}
            className="font-bold text-brand underline-offset-2 hover:underline"
          >
            {permalink}
          </a>
        </p>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={`${GHOST_LIGHT} mt-4 px-5 py-2 text-sm`}
        >
          Done
        </button>
      )}
    </div>
  );
}
