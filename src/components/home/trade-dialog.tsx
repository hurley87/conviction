/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { ConfirmCard } from "@/components/confirm-card";
import { GHOST_LIGHT, PRIMARY_LIGHT } from "@/components/button-styles";
import { ReceiptView } from "@/components/receipt-view";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { useQuickTradeFlow } from "@/hooks/use-quick-trade-flow";
import { useTradeTokens } from "@/hooks/use-trade-tokens";
import { IS_LIVE } from "@/lib/env";
import {
  searchTradeTokens,
  type TradeToken,
} from "@/lib/lifi-tokens";
import {
  availableTradeFundingSources,
  availableTradeUsd,
  type TradeFundingAsset,
} from "@/lib/trade-sources";
import { mockTradeSigners } from "@/lib/ua/mock";
import { chainName } from "@/lib/verbs/chains";
import type { TradeSigners } from "@/lib/verbs/types";

function TokenMark({ token }: { token: TradeToken }) {
  const [failed, setFailed] = useState(false);
  if (token.logoURI && !failed) {
    return (
      <img
        src={token.logoURI}
        alt=""
        width={38}
        height={38}
        className="h-9.5 w-9.5 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="grid h-9.5 w-9.5 place-items-center rounded-full bg-brand-soft text-xs font-black text-brand">
      {token.symbol.slice(0, 3).toUpperCase()}
    </span>
  );
}

function TradeBoard({
  signers,
  onClose,
  onBusyChange,
}: {
  signers: TradeSigners;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const account = useAccount();
  const { tokens, loading, error: tokenError, refresh } = useTradeTokens();
  const { flow, setDraft, requestQuote, confirmTrade, backToEdit } =
    useQuickTradeFlow({
      ua: account.ua,
      balance: account.balance,
      signers,
      handle: account.handle,
      onSuccess: account.refreshBalance,
      onUpgraded: account.markUpgraded,
    });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    onBusyChange(flow.status === "executing");
    return () => onBusyChange(false);
  }, [flow.status, onBusyChange]);

  const draft = flow.status === "success" ? null : flow.draft;
  const sources = useMemo(
    () => availableTradeFundingSources(account.balance),
    [account.balance],
  );
  const available = availableTradeUsd(
    account.balance,
    draft?.fromAsset ?? null,
  );
  const filtered = useMemo(
    () => searchTradeTokens(tokens, query).slice(0, 80),
    [tokens, query],
  );

  if (flow.status === "success") {
    const permalink =
      typeof window === "undefined"
        ? `/r/${flow.receipt.slug}`
        : `${window.location.origin}/r/${flow.receipt.slug}`;
    return (
      <ReceiptView
        receipt={flow.receipt}
        permalink={permalink}
        onDismiss={onClose}
      />
    );
  }

  if (flow.status === "confirm" || flow.status === "executing") {
    return (
      <div>
        {flow.status === "confirm" && flow.requoteNotice && (
          <p className="mb-3 rounded-[14px] border border-warning/25 bg-[#fff6df] p-3 text-xs text-warning">
            {flow.requoteNotice}
          </p>
        )}
        <ConfirmCard
          quote={flow.quote}
          executing={flow.status === "executing"}
          onConfirm={() => void confirmTrade()}
          onCancel={backToEdit}
        />
      </div>
    );
  }

  if (flow.status === "error") {
    return (
      <div className="rounded-[22px] border border-danger/20 bg-surface-2 p-5">
        <p className="text-sm leading-relaxed text-danger">{flow.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={backToEdit}
            className={`${PRIMARY_LIGHT} flex-1 text-sm`}
          >
            Edit and retry
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${GHOST_LIGHT} px-4 text-sm`}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (pickerOpen && draft) {
    return (
      <div className="min-h-[420px]">
        <button
          type="button"
          onClick={() => setPickerOpen(false)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-brand"
        >
          <span aria-hidden>←</span> Back to trade
        </button>
        <label className="block">
          <span className="sr-only">Search tokens</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search token or paste address"
            className="app-input w-full rounded-[16px] px-4 py-3 text-sm"
          />
        </label>

        {loading ? (
          <p className="py-12 text-center text-sm text-ink-3">
            Loading supported tokens…
          </p>
        ) : tokenError ? (
          <div className="py-10 text-center">
            <p className="text-sm text-danger">{tokenError}</p>
            <button
              type="button"
              onClick={() => void refresh(true)}
              className={`${GHOST_LIGHT} mt-4 px-5 text-sm`}
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-3">
            No matching Base or Arbitrum token.
          </p>
        ) : (
          <ul className="mt-4 max-h-[55dvh] space-y-1 overflow-y-auto">
            {filtered.map((token) => (
              <li key={`${token.chainId}:${token.address}`}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ token });
                    setPickerOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition hover:bg-surface-2"
                >
                  <TokenMark token={token} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-ink">
                      {token.symbol}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {token.name} · {chainName(token.chainId)}
                    </span>
                  </span>
                  {token.priceUSD != null && (
                    <span className="text-xs tabular-nums text-ink-3">
                      ${token.priceUSD.toLocaleString(undefined, {
                        maximumFractionDigits: token.priceUSD < 1 ? 4 : 2,
                      })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!draft) return null;
  const quoting = flow.status === "quoting";
  const formError = flow.status === "edit" ? flow.error : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void requestQuote();
      }}
    >
      <div>
        <p className="mb-2 text-xs font-bold text-ink-3">You receive</p>
        <button
          type="button"
          disabled={quoting}
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center gap-3 rounded-[18px] border border-line bg-surface-2/70 p-4 text-left transition hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
        >
          {draft.token ? (
            <>
              <TokenMark token={draft.token} />
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold text-ink">
                  {draft.token.symbol}
                </span>
                <span className="block truncate text-xs text-ink-3">
                  {draft.token.name} · {chainName(draft.token.chainId)}
                </span>
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm font-bold text-ink-3">
              Select a token
            </span>
          )}
          <span className="text-ink-3" aria-hidden>
            ›
          </span>
        </button>
      </div>

      <label className="block">
        <span className="text-xs font-bold text-ink-3">Pay with</span>
        <select
          value={draft.fromAsset ?? "any"}
          disabled={quoting}
          onChange={(event) =>
            setDraft({
              fromAsset:
                event.target.value === "any"
                  ? null
                  : (event.target.value as TradeFundingAsset),
            })
          }
          className="app-input mt-1 w-full rounded-[16px] px-4 py-3 text-sm"
        >
          <option value="any">
            Any balance · ${account.balance?.totalUsd.toFixed(2) ?? "0.00"}
          </option>
          {sources.map((source) => (
            <option key={source.asset} value={source.asset}>
              {source.symbol} · ${source.usd.toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-bold text-ink-3">You spend in USD</span>
        <div className="app-input mt-1 flex items-center rounded-[18px] px-4 py-3">
          <span className="text-2xl font-semibold text-ink-3">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={draft.amountRaw}
            disabled={quoting}
            onChange={(event) => setDraft({ amountRaw: event.target.value })}
            className="min-w-0 flex-1 bg-transparent px-2 text-3xl font-semibold tabular-nums text-ink outline-none"
          />
          <button
            type="button"
            disabled={quoting || available <= 0}
            onClick={() => setDraft({ amountRaw: available.toFixed(2) })}
            className="rounded-full bg-brand-soft px-3 py-1.5 text-xs font-extrabold text-brand disabled:opacity-40"
          >
            Max
          </button>
        </div>
        <span className="mt-1.5 block text-xs text-ink-4">
          Available: ${available.toFixed(2)}
        </span>
      </label>

      {formError && (
        <p className="text-xs leading-relaxed text-danger" role="alert">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={quoting || !account.ua}
        className={`${PRIMARY_LIGHT} w-full py-3 text-sm`}
      >
        {quoting ? "Finding the best route…" : "Review trade"}
      </button>
    </form>
  );
}

function LiveTradeBoard({
  onClose,
  onBusyChange,
}: {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const signers = useLiveTradeSigners();
  return (
    <TradeBoard
      signers={signers}
      onClose={onClose}
      onBusyChange={onBusyChange}
    />
  );
}

export function TradeDialogContent({
  onClose,
  onBusyChange,
}: {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  if (IS_LIVE) {
    return (
      <LiveTradeBoard onClose={onClose} onBusyChange={onBusyChange} />
    );
  }
  return (
    <TradeBoard
      signers={mockTradeSigners}
      onClose={onClose}
      onBusyChange={onBusyChange}
    />
  );
}
