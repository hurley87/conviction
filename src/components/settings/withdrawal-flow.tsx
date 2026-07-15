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
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Sent
        </p>
        <p className="mt-3 text-sm text-zinc-800">{flow.result.summary}</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Amount</dt>
            <dd className="tabular-nums text-zinc-900">
              {flow.result.amount} {withdrawalAssetLabel(flow.result.asset)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Network</dt>
            <dd className="text-zinc-900">{flow.result.destChain}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Estimated debit</dt>
            <dd className="tabular-nums text-zinc-900">
              {formatUsd(flow.result.estimatedDebitUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Fee</dt>
            <dd className="tabular-nums text-zinc-900">
              {formatUsd(flow.result.feeUsd)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Reference</dt>
            <dd className="font-mono text-xs text-zinc-600">
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
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Confirm withdrawal
        </p>
        {requoteNotice && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {requoteNotice}
          </p>
        )}
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-zinc-500">You&apos;re sending</span>
            <span className="text-xl font-semibold tabular-nums text-zinc-900">
              {quote.amount} {withdrawalAssetLabel(quote.asset)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-zinc-500">To</span>
            <span className="font-mono text-sm text-zinc-900">
              {truncateAddress(quote.destination)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-zinc-500">Network</span>
            <span className="text-sm text-zinc-900">{quote.destChain}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-zinc-100 pt-3">
            <span className="text-sm text-zinc-500">Estimated debit</span>
            <span className="text-sm tabular-nums text-zinc-600">
              {formatUsd(quote.estimatedDebitUsd)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-zinc-500">Fee</span>
            <span className="text-sm tabular-nums text-zinc-600">
              {formatUsd(quote.feeUsd)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-zinc-500">ETA</span>
            <span className="text-sm text-zinc-600">
              {formatEta(quote.etaSeconds)}
            </span>
          </div>
        </div>

        {executing ? (
          <p className="mt-5 text-center text-sm text-zinc-500">
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
      <div className="mt-4 rounded-2xl border border-red-100 bg-white p-5">
        <p className="text-sm text-red-600">{flow.message}</p>
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
    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Withdraw to external wallet
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="text-sm text-zinc-500 hover:text-zinc-700"
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
          <span className="text-xs font-medium text-zinc-500">Asset</span>
          <select
            value={draft.asset}
            disabled={quoting}
            onChange={(e) =>
              setDraft({ asset: e.target.value as WithdrawalAsset })
            }
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {WITHDRAWAL_ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {withdrawalAssetLabel(asset)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Network</span>
          <select
            value={draft.destChain}
            disabled={quoting}
            onChange={(e) =>
              setDraft({ destChain: e.target.value as DestChain })
            }
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {chains.map((chain) => (
              <option key={chain} value={chain}>
                {chain}
              </option>
            ))}
          </select>
          {draft.asset === "usdt" && (
            <span className="mt-1 block text-xs text-zinc-400">
              USDT withdrawals are available on Arbitrum only.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Amount</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={draft.asset === "eth" ? "0.01" : "25"}
            value={draft.amountRaw}
            disabled={quoting}
            onChange={(e) => setDraft({ amountRaw: e.target.value })}
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-zinc-500">
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
            className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-900"
          />
        </label>

        {formError && (
          <p className="text-xs text-red-500" role="alert">
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
