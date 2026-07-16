"use client";

// Deck back flow — browse → (add-money?) → size → quote → confirm → execute →
// receipt (issues #22 / #26). Swipe verbs persist so acted-on cards stay off
// the deck (#24).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { useSwipeState } from "@/hooks/use-swipe-state";
import {
  DEFAULT_COPY_FRACTION,
  executeQuotedCopy,
  quoteCopyConviction,
  type QuotedCopy,
} from "@/lib/verbs/copy";
import {
  backSwipeDestination,
  resumeSizingAfterFunds,
  sizeUsdForFraction,
} from "@/lib/verbs/deck";
import { remainingDeckCards } from "@/lib/verbs/swipe-state";
import { persistCopyResult } from "@/lib/persist-copy-result";
import type {
  ConvictionEntry,
  Receipt,
  TradeSigners,
} from "@/lib/verbs/types";

export type DeckFlow =
  | { status: "browse" }
  | { status: "addMoney"; entry: ConvictionEntry }
  | { status: "sizing" | "quoting"; entry: ConvictionEntry; fraction: number }
  | {
      status: "confirm" | "executing";
      entry: ConvictionEntry;
      fraction: number;
      quoted: QuotedCopy;
    }
  | { status: "receipt"; receipt: Receipt }
  | { status: "error"; message: string };

export function useDeckBackFlow(
  signers: TradeSigners,
  allCards: ConvictionEntry[],
) {
  const account = useAccount();
  const { state: swipeState, record } = useSwipeState(account.handle);
  const cards = useMemo(
    () => remainingDeckCards(allCards, swipeState),
    [allCards, swipeState],
  );
  const [flow, setFlow] = useState<DeckFlow>({ status: "browse" });

  const resetToBrowse = useCallback(() => {
    setFlow({ status: "browse" });
  }, []);

  const recordDeckVerb = useCallback(
    (verb: "skip" | "save") => {
      if (flow.status !== "browse") return;
      const current = cards[0];
      if (!current) return;
      record(current.entryId, verb);
    },
    [cards, flow.status, record],
  );

  const onSkip = useCallback(() => recordDeckVerb("skip"), [recordDeckVerb]);
  const onSave = useCallback(() => recordDeckVerb("save"), [recordDeckVerb]);

  const onBackSwipe = useCallback(
    (entry: ConvictionEntry) => {
      if (flow.status !== "browse") return;
      if (!account.handle) {
        account.login();
        return;
      }
      if (backSwipeDestination(account.balance) === "addMoney") {
        setFlow({ status: "addMoney", entry });
        return;
      }
      setFlow({
        status: "sizing",
        entry,
        fraction: DEFAULT_COPY_FRACTION,
      });
    },
    [account, flow.status],
  );

  // After funds arrive (onramp refresh or deposit), resume sizing for the
  // remembered card — never leave the user stuck on add-money with a balance.
  useEffect(() => {
    if (flow.status !== "addMoney") return;
    const next = resumeSizingAfterFunds(
      flow.status,
      flow.entry,
      account.balance,
      DEFAULT_COPY_FRACTION,
    );
    if (next) setFlow(next);
  }, [account.balance, flow]);

  const setFraction = useCallback((fraction: number) => {
    setFlow((prev) => {
      if (prev.status !== "sizing") return prev;
      return { ...prev, fraction };
    });
  }, []);

  const onContinueSizing = useCallback(async () => {
    if (flow.status !== "sizing") return;
    const { entry, fraction } = flow;
    const { ua, balance } = account;

    if (!ua || !balance) {
      setFlow({
        status: "error",
        message: "Add funds before backing a conviction.",
      });
      return;
    }
    const sizeUsd = sizeUsdForFraction(balance, fraction);
    if (sizeUsd <= 0) {
      setFlow({
        status: "error",
        message: "Add funds before backing a conviction.",
      });
      return;
    }

    setFlow({ status: "quoting", entry, fraction });
    try {
      const quoted = await quoteCopyConviction(
        entry,
        { ua, balance },
        sizeUsd,
      );
      setFlow({ status: "confirm", entry, fraction, quoted });
    } catch (e) {
      setFlow({
        status: "error",
        message: e instanceof Error ? e.message : "Couldn't get a quote.",
      });
    }
  }, [account, flow]);

  const onConfirm = useCallback(async () => {
    if (flow.status !== "confirm") return;
    const { entry, fraction, quoted } = flow;
    const { ua, balance, handle } = account;
    if (!ua || !balance || !handle) return;

    setFlow({ status: "executing", entry, fraction, quoted });
    try {
      const result = await executeQuotedCopy(quoted, {
        ua,
        balance,
        signers,
      });

      await persistCopyResult({
        receipt: result.receipt,
        entryId: entry.entryId,
        handle,
      });

      if (result.signed7702Auth) {
        account.markUpgraded();
      }

      record(entry.entryId, "back");
      setFlow({ status: "receipt", receipt: result.receipt });
    } catch (e) {
      setFlow({
        status: "error",
        message:
          e instanceof Error ? e.message : "Couldn't back this conviction.",
      });
    }
  }, [account, flow, record, signers]);

  const onReceiptDone = useCallback(() => {
    resetToBrowse();
  }, [resetToBrowse]);

  return {
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
  };
}
