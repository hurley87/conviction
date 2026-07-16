"use client";

// Home deck surface — swipe stack with add-money → sizing → confirm → receipt
// (issues #22 / #26). Skip / save / back persist; exhausted deck points to
// feed + Saved (#24).

import { useAccount } from "@/components/account/account-context";
import { ConfirmCard } from "@/components/confirm-card";
import { AddMoneySheet } from "@/components/deck/add-money-sheet";
import { Deck } from "@/components/deck/deck";
import { SizingSheet } from "@/components/deck/sizing-sheet";
import { ReceiptView } from "@/components/receipt-view";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { useDeckBackFlow } from "@/hooks/use-deck-back-flow";
import { IS_LIVE } from "@/lib/env";
import { backSwipeDestination } from "@/lib/verbs/deck";
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <div className="h-96 w-full animate-pulse rounded-[32px] bg-surface-3" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="font-display text-4xl font-semibold text-ink">Welcome to Conviction</h1>
        <p className="mt-3 max-w-md text-ink-3">
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
  const isSizingPhase =
    flow.status === "sizing" || flow.status === "quoting";
  const fundingDestination = backSwipeDestination(account.balance);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 pb-16">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_0_5px_rgba(79,138,90,0.1)]" />
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-ink-3">
              Today’s curated drop · {cards.length} {cards.length === 1 ? "card" : "cards"} left
            </p>
          </div>
          <h1 className="mt-4 font-display text-[clamp(3.25rem,7vw,6rem)] font-medium leading-[0.88] tracking-[-0.055em] text-ink">
            Discover what
            <br />
            <span className="italic text-brand">deserves backing.</span>
          </h1>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-ink-3 sm:pb-2">
          Read other people&apos;s revealed positions from across crypto—their
          thesis, timing, and risk. Skip what you don&apos;t believe, save what
          you&apos;re watching, or back it at your own size.
        </p>
      </div>

      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="relative flex min-h-[660px] items-start justify-center rounded-[34px] border border-line bg-surface/32 px-3 pb-24 pt-8 shadow-sm backdrop-blur-sm sm:px-8">
          <div
            className="pointer-events-none absolute left-[12%] top-12 h-60 w-60 rounded-full opacity-35 blur-[70px]"
            style={{ background: "var(--pt-grad-dawn)" }}
            aria-hidden
          />
          <Deck
            cards={cards}
            onSkip={onSkip}
            onSave={onSave}
            onBack={onBackSwipe}
            interactive={!overlayOpen}
          />
        </div>

        <aside className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {[
            {
              n: "01",
              action: "Skip",
              gesture: "Swipe left",
              copy: "Not for you? Move on cleanly.",
              tint: "var(--pt-mood-tired)",
            },
            {
              n: "02",
              action: "Save",
              gesture: "Swipe up",
              copy: "Interesting, but not actionable yet.",
              tint: "var(--pt-mood-joyful)",
            },
            {
              n: "03",
              action: "Back",
              gesture: "Swipe right",
              copy: "Choose your own size before confirming.",
              tint: "var(--pt-mood-calm)",
            },
          ].map((item) => (
            <div
              key={item.action}
              className="app-card app-card-interactive p-4 lg:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className="grid h-8 w-8 place-items-center rounded-xl text-[10px] font-extrabold text-ink"
                  style={{ background: item.tint }}
                >
                  {item.n}
                </span>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-4">
                  {item.gesture}
                </span>
              </div>
              <p className="mt-4 font-display text-xl font-semibold text-ink">
                {item.action}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-3">
                {item.copy}
              </p>
            </div>
          ))}
        </aside>
      </div>

      {overlayOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--pt-overlay)] p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md">
            {isSizingPhase && fundingDestination === "addMoney" && (
              <AddMoneySheet
                deposits={account.deposits}
                onAddMoney={account.addMoney}
                isFunding={account.isFunding}
                fundingError={account.fundingError}
                onCancel={resetToBrowse}
              />
            )}

            {isSizingPhase &&
              fundingDestination === "sizing" &&
              sizingFraction != null &&
              account.balance && (
                <SizingSheet
                  balance={account.balance}
                  selectedFraction={sizingFraction}
                  onSelectFraction={setFraction}
                  onContinue={() => void onContinueSizing()}
                  onCancel={resetToBrowse}
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
              <div className="rounded-[24px] border border-danger/20 bg-surface p-5 text-left shadow-lg">
                <p className="text-sm text-danger">{flow.message}</p>
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
