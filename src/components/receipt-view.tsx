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
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Receipt
      </p>

      <p className="mt-3 text-sm text-zinc-600">{receipt.summary}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-zinc-500">Spent</dt>
          <dd className="tabular-nums text-zinc-900">
            {formatUsd(receipt.dollarsIn)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500">Received</dt>
          <dd className="tabular-nums text-emerald-600">
            {formatUsd(receipt.dollarsOut)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-zinc-500">Fee</dt>
          <dd className="tabular-nums text-zinc-600">
            {formatUsd(receipt.feeUsd)}
          </dd>
        </div>
      </dl>

      {receipt.legs.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
          {receipt.legs.map((leg) => (
            <li key={`${leg.chain}-${leg.txHash}`} className="text-sm">
              <span className="font-medium text-zinc-900">{leg.chain}</span>
              {" · "}
              <a
                href={leg.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline-offset-2 hover:underline"
              >
                View on explorer
              </a>
            </li>
          ))}
        </ul>
      )}

      {permalink && (
        <p className="mt-4 break-all text-xs text-zinc-500">
          Share:{" "}
          <a
            href={permalink}
            className="text-blue-600 underline-offset-2 hover:underline"
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
