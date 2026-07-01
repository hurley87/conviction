"use client";

// Hook for backing a conviction from the feed (issue #5).

import { useCallback, useState } from "react";
import type { UAClient } from "@/lib/ua/types";
import { copyConviction } from "@/lib/verbs/copy";
import type {
  ConvictionEntry,
  Receipt,
  TradeSigners,
  UniversalBalance,
} from "@/lib/verbs/types";

export type BackPhase = "idle" | "backing" | "backed" | "error";

export type EntryBackState = {
  phase: BackPhase;
  backedBy: string[];
  receipt: Receipt | null;
  error: string | null;
};

export type UseBackerDeps = {
  ua: UAClient | null;
  balance: UniversalBalance | null;
  signers: TradeSigners;
  handle: string | null;
  /** Called when the user must sign in before backing (live path). */
  onSignIn?: () => void;
};

function defaultEntryState(entry: ConvictionEntry): EntryBackState {
  return {
    phase: "idle",
    backedBy: entry.backedBy,
    receipt: null,
    error: null,
  };
}

function mergeEntryState(
  entry: ConvictionEntry,
  prev: Record<string, EntryBackState>,
  patch: Partial<EntryBackState>,
): EntryBackState {
  return {
    ...defaultEntryState(entry),
    ...prev[entry.entryId],
    ...patch,
  };
}

export function useBacker({
  ua,
  balance,
  signers,
  handle,
  onSignIn,
}: UseBackerDeps) {
  const [entries, setEntries] = useState<Record<string, EntryBackState>>({});

  const getEntryState = useCallback(
    (entry: ConvictionEntry): EntryBackState =>
      entries[entry.entryId] ?? defaultEntryState(entry),
    [entries],
  );

  const back = useCallback(
    async (entry: ConvictionEntry, override?: number) => {
      if (!handle) {
        onSignIn?.();
        return;
      }
      if (!ua || !balance || balance.totalUsd <= 0) {
        setEntries((prev) => ({
          ...prev,
          [entry.entryId]: mergeEntryState(entry, prev, {
            phase: "error",
            error: "Add funds before backing a conviction.",
          }),
        }));
        return;
      }

      setEntries((prev) => ({
        ...prev,
        [entry.entryId]: mergeEntryState(entry, prev, {
          phase: "backing",
          error: null,
        }),
      }));

      try {
        const result = await copyConviction(
          entry,
          { ua, balance, signers },
          override,
        );

        void fetch("/api/receipts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result.receipt),
        }).catch(() => {});

        const res = await fetch("/api/convictions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entryId: entry.entryId, handle }),
        });
        if (!res.ok) {
          throw new Error("Failed to record your back");
        }
        const data = (await res.json()) as { backedBy: string[] };

        setEntries((prev) => ({
          ...prev,
          [entry.entryId]: mergeEntryState(entry, prev, {
            phase: "backed",
            backedBy: data.backedBy,
            receipt: result.receipt,
            error: null,
          }),
        }));
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Couldn't back this conviction.";
        setEntries((prev) => ({
          ...prev,
          [entry.entryId]: mergeEntryState(entry, prev, {
            phase: "error",
            error: msg,
          }),
        }));
      }
    },
    [ua, balance, signers, handle, onSignIn],
  );

  return {
    back,
    getEntryState,
    handle,
  };
}

export type BackerApi = ReturnType<typeof useBacker>;
