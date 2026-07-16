"use client";

import { useWithdrawalFlow } from "@/hooks/use-withdrawal-flow";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { formatUsd, truncateAddress } from "@/lib/format";
import { formatEta } from "@/lib/verbs/quote";
import type {
  DestChain,
  TradeSigners,
  UniversalBalance,
  WithdrawalAsset,
} from "@/lib/verbs/types";
import type { UAClient } from "@/lib/ua/types";
import {
  WITHDRAWAL_ASSETS,
  supportedWithdrawalChains,
  withdrawalAssetLabel,
} from "@/lib/verbs/withdrawal";

type WithdrawalFlowProps = {
  ua: UAClient | null;
  signers: TradeSigners;
  ownerAddress: string | null;
  balance: UniversalBalance | null;
  handle: string | null;
  onSuccess?: () => Promise<void> | void;
  onUpgraded?: () => void;
  onClose: () => void;
};

export function WithdrawalFlow({
  ua,
  signers,
  ownerAddress,
  balance,
  handle,
  onSuccess,
  onUpgraded,
  onClose,
}: WithdrawalFlowProps) {
  const { flow, setDraft, requestQuote, confirmSend, backToEdit, reset } =
    useWithdrawalFlow({
      ua,
      signers,
      ownerAddress,
      balance,
      handle,
      onSuccess,
      onUpgraded,
    });

  const handleClose = () => {
    reset();
    onClose();
  };

  if (flow.status === "success") {
    return (
      <div className="mt-4 rounded-[22px] border border-line bg-surface-2/60 p-5">
        <p className="pt-eyebrow">Sent</p>
        <p className="mt-3 text-sm text-ink">{flow.result.summary}</p>
        <dl className="mt-4 space-y-2 rounded-[16px] bg-surface p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Amount</dt>
            <dd className="font-bold tabular-nums text-ink">
              {flow.result.amount} {withdrawalAssetLabel(flow.result.asset)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Network</dt>
            <dd className="text-ink">{flow.result.destChain}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Estimated debit</dt>
            <dd className="tabular-nums text-ink">
              {formatUsd(flow.result.estimatedDebitUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Fee</dt>
            <dd className="tabular-nums text-ink">
              {formatUsd(flow.result.feeUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-3">Reference</dt>
            <dd className="font-mono text-xs text-ink-2">
              {flow.result.transactionId}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={handleClose}
          className={`${PRIMARY_LIGHT} mt-5 w-full py-2 text-sm`}
        >
          Done
        </button>
      </div>
    );
  }

  if (flow.status === "confirm" || flow.status === "executing") {
    const { quote } = flow;
    const executing = flow.status === "executing";
    const requoteNotice =
      flow.status === "confirm" ? flow.requoteNotice : null;
    return (
      <div className="mt-4 rounded-[22px] border border-line bg-surface-2/60 p-5">
        <p className="pt-eyebrow">Confirm withdrawal</p>
        {requoteNotice && (
          <p className="mt-3 rounded-[14px] border border-warning/25 bg-[#fff6df] p-3 text-xs text-warning">
            {requoteNotice}
          </p>
        )}
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-3">You&apos;re sending</span>
            <span className="text-xl font-semibold tabular-nums text-ink">
              {quote.amount} {withdrawalAssetLabel(quote.asset)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-3">To</span>
            <span className="font-mono text-sm text-ink">
              {truncateAddress(quote.destination)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-3">Network</span>
            <span className="text-sm text-ink">{quote.destChain}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <span className="text-sm text-ink-3">Estimated debit</span>
            <span className="text-sm tabular-nums text-ink-2">
              {formatUsd(quote.estimatedDebitUsd)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-3">Fee</span>
            <span className="text-sm tabular-nums text-ink-2">
              {formatUsd(quote.feeUsd)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-ink-3">ETA</span>
            <span className="text-sm text-ink-2">
              {formatEta(quote.etaSeconds)}
            </span>
          </div>
        </div>

        {executing ? (
          <p className="mt-5 text-center text-sm text-ink-3">
            Check your wallet to sign, then wait while we send…
          </p>
        ) : (
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmSend()}
              className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
            >
              Confirm send
            </button>
            <button
              type="button"
              onClick={backToEdit}
              className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (flow.status === "error") {
    return (
      <div className="mt-4 rounded-[22px] border border-danger/20 bg-surface p-5">
        <p className="text-sm text-danger">{flow.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={backToEdit}
            className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
          >
            Edit and retry
          </button>
          <button
            type="button"
            onClick={handleClose}
            className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const draft = flow.draft;
  const quoting = flow.status === "quoting";
  const formError = flow.status === "edit" ? flow.error : null;
  const chains = supportedWithdrawalChains(draft.asset);

  return (
    <div className="mt-4 rounded-[22px] border border-line bg-surface-2/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="pt-eyebrow">Withdraw to external wallet</p>
        <button
          type="button"
          onClick={handleClose}
          className="text-sm font-bold text-ink-3 hover:text-ink"
        >
          Close
        </button>
      </div>

      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void requestQuote();
        }}
      >
        <label className="block">
          <span className="text-xs font-bold text-ink-3">Asset</span>
          <select
            value={draft.asset}
            disabled={quoting}
            onChange={(e) =>
              setDraft({ asset: e.target.value as WithdrawalAsset })
            }
            className="app-input mt-1 w-full rounded-xl px-3 py-2 text-sm"
          >
            {WITHDRAWAL_ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {withdrawalAssetLabel(asset)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-bold text-ink-3">Network</span>
          <select
            value={draft.destChain}
            disabled={quoting}
            onChange={(e) =>
              setDraft({ destChain: e.target.value as DestChain })
            }
            className="app-input mt-1 w-full rounded-xl px-3 py-2 text-sm"
          >
            {chains.map((chain) => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
          {draft.asset === "usdt" && (
            <span className="mt-1 block text-xs text-ink-4">
              USDT withdrawals are available on Arbitrum only.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-xs font-bold text-ink-3">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={draft.asset === "eth" ? "0.01" : "25"}
            value={draft.amountRaw}
            disabled={quoting}
            onChange={(e) => setDraft({ amountRaw: e.target.value })}
            className="app-input mt-1 w-full rounded-xl px-3 py-2 text-sm tabular-nums"
          />
        </label>

        <label className="block">
          <span className="text-xs font-bold text-ink-3">
            Destination address
          </span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={draft.destinationRaw}
            disabled={quoting}
            onChange={(e) => setDraft({ destinationRaw: e.target.value })}
            className="app-input mt-1 w-full rounded-xl px-3 py-2 font-mono text-sm"
          />
        </label>

        {formError && (
          <p className="text-xs text-danger" role="alert">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={quoting || !ua}
          className={`${PRIMARY_LIGHT} w-full py-2.5 text-sm disabled:opacity-50`}
        >
          {quoting ? "Getting quote…" : "Review send"}
        </button>
      </form>
    </div>
  );
}
