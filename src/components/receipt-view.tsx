// Opt-in receipt surface — the only place chain names and explorer links
// appear in the UI (ADR 0013).

import type { Receipt } from "@/lib/verbs/types";
import { formatUsd } from "@/lib/format";
import { GHOST } from "@/components/button-styles";

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
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#6b7099]">
        Receipt
      </p>

      <p className="mt-3 text-sm text-[#aeb4d6]">{receipt.summary}</p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-[#6b7099]">Spent</dt>
          <dd className="tabular-nums text-white">
            {formatUsd(receipt.dollarsIn)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[#6b7099]">Received</dt>
          <dd className="tabular-nums text-[#37E0C8]">
            {formatUsd(receipt.dollarsOut)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[#6b7099]">Fee</dt>
          <dd className="tabular-nums text-[#aeb4d6]">
            {formatUsd(receipt.feeUsd)}
          </dd>
        </div>
      </dl>

      {receipt.legs.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-white/5 pt-4">
          {receipt.legs.map((leg) => (
            <li key={`${leg.chain}-${leg.txHash}`} className="text-sm">
              <span className="font-medium text-white">{leg.chain}</span>
              {" · "}
              <a
                href={leg.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6C7BFF] underline-offset-2 hover:underline"
              >
                View on explorer
              </a>
            </li>
          ))}
        </ul>
      )}

      {permalink && (
        <p className="mt-4 text-xs text-[#6b7099]">
          Share:{" "}
          <a
            href={permalink}
            className="text-[#6C7BFF] underline-offset-2 hover:underline"
          >
            {permalink}
          </a>
        </p>
      )}

      {onDismiss && (
        <button type="button" onClick={onDismiss} className={`${GHOST} mt-4`}>
          Done
        </button>
      )}
    </div>
  );
}
