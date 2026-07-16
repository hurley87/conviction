"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeToken } from "@/lib/lifi-tokens";
import type { TradeFundingAsset } from "@/lib/trade-sources";
import type { UAClient } from "@/lib/ua/types";
import { destChainFromId } from "@/lib/verbs/chains";
import { validateIntent } from "@/lib/verbs/intent";
import { generateReceiptSlug } from "@/lib/verbs/receipt";
import {
  FloorAbortError,
  type Receipt,
  type TradeIntent,
  type TradeQuote,
  type TradeSigners,
  type UniversalBalance,
} from "@/lib/verbs/types";

export type QuickTradeDraft = {
  token: TradeToken | null;
  fromAsset: TradeFundingAsset | null;
  amountRaw: string;
};

type TradeFlowState =
  | { status: "edit"; draft: QuickTradeDraft; error: string | null }
  | { status: "quoting"; draft: QuickTradeDraft }
  | {
      status: "confirm";
      draft: QuickTradeDraft;
      intent: TradeIntent;
      sizeUsd: number;
      quote: TradeQuote;
      requoteNotice?: string | null;
    }
  | {
      status: "executing";
      draft: QuickTradeDraft;
      intent: TradeIntent;
      sizeUsd: number;
      quote: TradeQuote;
    }
  | { status: "success"; receipt: Receipt }
  | { status: "error"; draft: QuickTradeDraft; message: string };

const DEFAULT_DRAFT: QuickTradeDraft = {
  token: null,
  fromAsset: null,
  amountRaw: "",
};

function draftFrom(state: TradeFlowState): QuickTradeDraft {
  if (state.status === "success") return DEFAULT_DRAFT;
  return state.draft;
}

function parseUsdAmount(raw: string):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter an amount to trade." };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid USD amount." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  return { ok: true, value };
}

export function useQuickTradeFlow({
  ua,
  balance,
  signers,
  handle,
  onSuccess,
  onUpgraded,
}: {
  ua: UAClient | null;
  balance: UniversalBalance | null;
  signers: TradeSigners;
  handle: string | null;
  onSuccess?: () => Promise<void> | void;
  onUpgraded?: () => void;
}) {
  const [flow, setFlow] = useState<TradeFlowState>({
    status: "edit",
    draft: DEFAULT_DRAFT,
    error: null,
  });
  const flowRef = useRef(flow);
  const executingRef = useRef(false);

  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  const setDraft = useCallback((patch: Partial<QuickTradeDraft>) => {
    setFlow((current) => {
      if (current.status !== "edit" && current.status !== "error") {
        return current;
      }
      return {
        status: "edit",
        draft: { ...current.draft, ...patch },
        error: null,
      };
    });
  }, []);

  const reset = useCallback(() => {
    executingRef.current = false;
    setFlow({ status: "edit", draft: DEFAULT_DRAFT, error: null });
  }, []);

  const backToEdit = useCallback(() => {
    executingRef.current = false;
    setFlow((current) => ({
      status: "edit",
      draft: draftFrom(current),
      error: null,
    }));
  }, []);

  const requestQuote = useCallback(async () => {
    const draft = draftFrom(flowRef.current);
    if (!ua || !balance) {
      setFlow({
        status: "edit",
        draft,
        error: "Your Universal Account is not ready yet.",
      });
      return;
    }
    if (!draft.token) {
      setFlow({
        status: "edit",
        draft,
        error: "Choose a token to receive.",
      });
      return;
    }
    const amount = parseUsdAmount(draft.amountRaw);
    if (!amount.ok) {
      setFlow({ status: "edit", draft, error: amount.error });
      return;
    }
    const destChain = destChainFromId(draft.token.chainId);
    if (!destChain) {
      setFlow({
        status: "edit",
        draft,
        error: "That token is not on a supported settlement network.",
      });
      return;
    }

    const intent: TradeIntent = {
      toAsset: "token",
      token: {
        chainId: draft.token.chainId,
        address: draft.token.address,
        symbol: draft.token.symbol,
      },
      sizeUsd: amount.value,
      destChain,
      ...(draft.fromAsset ? { fromAsset: draft.fromAsset } : {}),
    };
    const validated = validateIntent(intent, balance);
    if (!validated.ok) {
      setFlow({ status: "edit", draft, error: validated.error });
      return;
    }

    setFlow({ status: "quoting", draft });
    try {
      const quote = await ua.quoteTrade({
        intent: validated.intent,
        sizeUsd: validated.sizeUsd,
      });
      setFlow({
        status: "confirm",
        draft,
        intent: validated.intent,
        sizeUsd: validated.sizeUsd,
        quote,
        requoteNotice: null,
      });
    } catch (error) {
      setFlow({
        status: "edit",
        draft,
        error:
          error instanceof Error
            ? error.message
            : "Could not find a route for that token.",
      });
    }
  }, [ua, balance]);

  const confirmTrade = useCallback(async () => {
    if (executingRef.current) return;
    const current = flowRef.current;
    if (!ua || current.status !== "confirm") return;
    const { draft, intent, sizeUsd, quote } = current;
    executingRef.current = true;
    setFlow({
      status: "executing",
      draft,
      intent,
      sizeUsd,
      quote,
    });

    const receiptSlug = generateReceiptSlug();
    try {
      const result = await ua.executeTrade({
        intent,
        sizeUsd,
        agreedQuote: quote,
        signers,
        receiptSlug,
      });
      setFlow({ status: "success", receipt: result.receipt });

      if (result.signed7702Auth) onUpgraded?.();
      void Promise.resolve(onSuccess?.()).catch(() => {});
      void fetch("/api/receipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.receipt),
      }).catch(() => {});
      if (handle) {
        void fetch("/api/activity", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            handle,
            kind: "trade",
            summary: result.summary,
            amountUsd: sizeUsd,
            receiptSlug,
          }),
        }).catch(() => {});
      }
    } catch (error) {
      if (error instanceof FloorAbortError) {
        setFlow({
          status: "confirm",
          draft,
          intent,
          sizeUsd,
          quote: error.freshQuote,
          requoteNotice: "The price moved — review the updated quote.",
        });
        return;
      }
      setFlow({
        status: "error",
        draft,
        message:
          error instanceof Error ? error.message : "Trade failed. Try again.",
      });
    } finally {
      executingRef.current = false;
    }
  }, [ua, signers, handle, onSuccess, onUpgraded]);

  return {
    flow,
    setDraft,
    requestQuote,
    confirmTrade,
    backToEdit,
    reset,
  };
}
