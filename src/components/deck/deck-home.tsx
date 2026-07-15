"use client";

// Home deck surface — swipe stack with sizing → confirm → receipt (issue #22).
// Skip / save / back persist; exhausted deck points to feed + Saved (#24).

import { useAccount } from "@/components/account/account-context";
import { ConfirmCard } from "@/components/confirm-card";
import { Deck } from "@/components/deck/deck";
import { SizingSheet } from "@/components/deck/sizing-sheet";
import { ReceiptView } from "@/components/receipt-view";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { useDeckBackFlow } from "@/hooks/use-deck-back-flow";
import { IS_LIVE } from "@/lib/env";
import type { ConvictionEntry, TradeSigners } from "@/lib/verbs/types";

type DeckHomeProps = {
  cards: ConvictionEntry[];
  signers: TradeSigners;
};

export function DeckHome({ cards: allCards, signers }: DeckHomeProps) {
  const account = useAccount();
  const {
    cards,
    flow,
    onSkip,
    onSave,
    onBackSwipe,
    setFraction,
    onContinueSizing,
    onConfirm,
    onReceiptDone,
    resetToBrowse,
  } = useDeckBackFlow(signers, allCards);

  if (!account.ready) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <div className="h-96 w-full animate-pulse rounded-3xl bg-zinc-100" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-3xl font-bold text-zinc-900">Welcome to Conviction</h1>
        <p className="mt-3 max-w-md text-zinc-500">
          Sign in to flip today&apos;s deck and back real positions.
        </p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} mt-8 px-8 py-3`}
        >
          Sign in with Twitter
        </button>
      </div>
    );
  }

  const overlayOpen = flow.status !== "browse";
  const sizingFraction =
    flow.status === "sizing" ||
    flow.status === "quoting" ||
    flow.status === "confirm" ||
    flow.status === "executing"
      ? flow.fraction
      : undefined;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 pb-20">
      <div>
        <h1 className="text-3xl font-bold text-zinc-900">Deck</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Today&apos;s drops — skip left, save up, back right.
        </p>
      </div>

      <Deck
        cards={cards}
        onSkip={onSkip}
        onSave={onSave}
        onBack={onBackSwipe}
        interactive={!overlayOpen}
      />

      {overlayOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md">
            {(flow.status === "sizing" || flow.status === "quoting") &&
              sizingFraction != null && (
                <SizingSheet
                  balance={account.balance}
                  selectedFraction={sizingFraction}
                  onSelectFraction={setFraction}
                  onContinue={() => void onContinueSizing()}
                  onCancel={resetToBrowse}
                  onAddMoney={account.addMoney}
                  isFunding={account.isFunding}
                  quoting={flow.status === "quoting"}
                />
              )}

            {(flow.status === "confirm" || flow.status === "executing") && (
              <ConfirmCard
                quote={flow.quoted.quote}
                executing={flow.status === "executing"}
                onConfirm={() => void onConfirm()}
                onCancel={resetToBrowse}
              />
            )}

            {flow.status === "receipt" && (
              <ReceiptView
                receipt={flow.receipt}
                permalink={`/r/${flow.receipt.slug}`}
                onDismiss={onReceiptDone}
              />
            )}

            {flow.status === "error" && (
              <div className="rounded-2xl border border-red-100 bg-white p-5 text-left">
                <p className="text-sm text-red-600">{flow.message}</p>
                <button
                  type="button"
                  onClick={resetToBrowse}
                  className={`${PRIMARY_LIGHT} mt-4 px-5 py-2 text-sm`}
                >
                  Back to deck
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
