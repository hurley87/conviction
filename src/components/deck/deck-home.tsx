"use client";

// Home deck surface — swipe stack with sizing → confirm → receipt (issue #22).

import { useCallback, useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { ConfirmCard } from "@/components/confirm-card";
import { Deck } from "@/components/deck/deck";
import { SizingSheet } from "@/components/deck/sizing-sheet";
import { ReceiptView } from "@/components/receipt-view";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import {
  DEFAULT_COPY_FRACTION,
  executeQuotedCopy,
  quoteCopyConviction,
  type QuotedCopy,
} from "@/lib/verbs/copy";
import { sizeUsdForFraction } from "@/lib/verbs/deck";
import { IS_LIVE } from "@/lib/env";
import type { UAClient } from "@/lib/ua/types";
import type {
  ConvictionEntry,
  Receipt,
  TradeSigners,
  UniversalBalance,
} from "@/lib/verbs/types";

type DeckPhase =
  | "browse"
  | "sizing"
  | "quoting"
  | "confirm"
  | "executing"
  | "receipt"
  | "error";

type DeckHomeProps = {
  cards: ConvictionEntry[];
  ua: UAClient | null;
  balance: UniversalBalance | null;
  signers: TradeSigners;
  handle: string | null;
  onSignIn?: () => void;
  onUpgraded?: () => void;
  onAddMoney?: () => void | Promise<void>;
  isFunding?: boolean;
};

export function DeckHome({
  cards,
  ua,
  balance,
  signers,
  handle,
  onSignIn,
  onUpgraded,
  onAddMoney,
  isFunding,
}: DeckHomeProps) {
  const account = useAccount();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<DeckPhase>("browse");
  const [active, setActive] = useState<ConvictionEntry | null>(null);
  const [fraction, setFraction] = useState(DEFAULT_COPY_FRACTION);
  const [quoted, setQuoted] = useState<QuotedCopy | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const advance = useCallback(() => {
    setIndex((i) => i + 1);
  }, []);

  const resetOverlay = useCallback(() => {
    setPhase("browse");
    setActive(null);
    setQuoted(null);
    setReceipt(null);
    setError(null);
    setFraction(DEFAULT_COPY_FRACTION);
  }, []);

  const onSkip = useCallback(() => {
    if (phase !== "browse") return;
    advance();
  }, [advance, phase]);

  const onBackSwipe = useCallback(
    (entry: ConvictionEntry) => {
      if (phase !== "browse") return;
      if (!handle) {
        onSignIn?.();
        return;
      }
      setActive(entry);
      setFraction(DEFAULT_COPY_FRACTION);
      setPhase("sizing");
    },
    [handle, onSignIn, phase],
  );

  const onContinueSizing = useCallback(async () => {
    if (!active || !ua || !balance) {
      setError("Add funds before backing a conviction.");
      setPhase("error");
      return;
    }
    const sizeUsd = sizeUsdForFraction(balance, fraction);
    if (sizeUsd <= 0) {
      setError("Add funds before backing a conviction.");
      setPhase("error");
      return;
    }

    setPhase("quoting");
    setError(null);
    try {
      const q = await quoteCopyConviction(active, { ua, balance }, sizeUsd);
      setQuoted(q);
      setPhase("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get a quote.");
      setPhase("error");
    }
  }, [active, balance, fraction, ua]);

  const onConfirm = useCallback(async () => {
    if (!active || !ua || !balance || !quoted || !handle) return;
    setPhase("executing");
    setError(null);
    try {
      const result = await executeQuotedCopy(quoted, { ua, balance, signers });

      void fetch("/api/receipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.receipt),
      }).catch(() => {});

      await fetch("/api/convictions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entryId: active.entryId, handle }),
      }).catch(() => {});

      if (result.signed7702Auth) {
        onUpgraded?.();
      }

      setReceipt(result.receipt);
      setPhase("receipt");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't back this conviction.",
      );
      setPhase("error");
    }
  }, [active, balance, handle, onUpgraded, quoted, signers, ua]);

  const onReceiptDone = useCallback(() => {
    resetOverlay();
    advance();
  }, [advance, resetOverlay]);

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

  const overlayOpen = phase !== "browse";

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 pb-20">
      <div>
        <h1 className="text-3xl font-bold text-zinc-900">Deck</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Today&apos;s drops — skip left, back right.
        </p>
      </div>

      <Deck
        cards={cards}
        index={index}
        onSkip={onSkip}
        onBack={onBackSwipe}
        interactive={!overlayOpen}
      />

      {overlayOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <div className="w-full max-w-md">
            {(phase === "sizing" || phase === "quoting") && (
              <SizingSheet
                balance={balance}
                selectedFraction={fraction}
                onSelectFraction={setFraction}
                onContinue={() => void onContinueSizing()}
                onCancel={resetOverlay}
                onAddMoney={onAddMoney}
                isFunding={isFunding}
                quoting={phase === "quoting"}
              />
            )}

            {(phase === "confirm" || phase === "executing") && quoted && (
              <ConfirmCard
                quote={quoted.quote}
                executing={phase === "executing"}
                onConfirm={() => void onConfirm()}
                onCancel={resetOverlay}
              />
            )}

            {phase === "receipt" && receipt && (
              <ReceiptView
                receipt={receipt}
                permalink={`/r/${receipt.slug}`}
                onDismiss={onReceiptDone}
              />
            )}

            {phase === "error" && (
              <div className="rounded-2xl border border-red-100 bg-white p-5 text-left">
                <p className="text-sm text-red-600">
                  {error ?? "Something went wrong."}
                </p>
                <button
                  type="button"
                  onClick={resetOverlay}
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
