"use client";

// Core concierge state machine — no Privy dependency (ADR 0014 mock path).

import { useCallback, useState } from "react";
import type { UAClient } from "@/lib/ua";
import { parseIntent, validateIntent } from "@/lib/verbs/intent";
import { generateReceiptSlug } from "@/lib/verbs/receipt";
import {
  FloorAbortError,
  type Receipt,
  type TradeIntent,
  type TradeQuote,
  type TradeSigners,
  type UniversalBalance,
} from "@/lib/verbs/types";

export type ConciergeMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ConciergePhase =
  | "idle"
  | "clarify"
  | "quoting"
  | "confirm"
  | "executing"
  | "done"
  | "error";

export function useConciergeCore(
  ua: UAClient | null,
  balance: UniversalBalance | null,
  signers: TradeSigners,
) {
  const [messages, setMessages] = useState<ConciergeMessage[]>([
    {
      role: "assistant",
      text: "What would you like to do? For example: \"Move $25 to cash\" or \"Convert half my ETH to cash\".",
    },
  ]);
  const [phase, setPhase] = useState<ConciergePhase>("idle");
  const [pendingQuote, setPendingQuote] = useState<TradeQuote | null>(null);
  const [pendingIntent, setPendingIntent] = useState<TradeIntent | null>(null);
  const [pendingSizeUsd, setPendingSizeUsd] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const appendMessage = useCallback((msg: ConciergeMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const submitText = useCallback(
    async (text: string) => {
      if (!ua || !balance) return;
      setError(null);
      appendMessage({ role: "user", text });

      const parsed = parseIntent(text);
      if (parsed.kind === "clarify") {
        setPhase("clarify");
        appendMessage({ role: "assistant", text: parsed.question });
        return;
      }

      const validation = validateIntent(parsed.intent, balance);
      if (!validation.ok) {
        setPhase("error");
        setError(validation.error);
        appendMessage({ role: "assistant", text: validation.error });
        return;
      }

      setPhase("quoting");
      try {
        const quote = await ua.quoteTrade({
          intent: validation.intent,
          sizeUsd: validation.sizeUsd,
        });
        setPendingQuote(quote);
        setPendingIntent(validation.intent);
        setPendingSizeUsd(validation.sizeUsd);
        setPhase("confirm");
        appendMessage({
          role: "assistant",
          text: "Here's your quote — review and confirm below.",
        });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Couldn't get a quote. Try again.";
        setPhase("error");
        setError(msg);
        appendMessage({ role: "assistant", text: msg });
      }
    },
    [ua, balance, appendMessage],
  );

  const confirmTrade = useCallback(async () => {
    if (!ua || !pendingQuote || !pendingIntent || pendingSizeUsd == null) {
      return;
    }
    setPhase("executing");
    setError(null);

    const slug = generateReceiptSlug();

    try {
      const result = await ua.executeTrade({
        intent: pendingIntent,
        sizeUsd: pendingSizeUsd,
        agreedQuote: pendingQuote,
        signers,
        receiptSlug: slug,
      });

      setReceipt(result.receipt);
      setPhase("done");
      appendMessage({ role: "assistant", text: result.summary });

      void fetch("/api/receipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.receipt),
      }).catch(() => {});
    } catch (e) {
      if (e instanceof FloorAbortError) {
        setPendingQuote(e.freshQuote);
        setPhase("confirm");
        appendMessage({
          role: "assistant",
          text: "The price moved since you last saw it — please review the updated quote and confirm again.",
        });
        return;
      }
      const msg =
        e instanceof Error ? e.message : "Trade failed. Please try again.";
      setPhase("error");
      setError(msg);
      appendMessage({ role: "assistant", text: msg });
    }
  }, [ua, pendingQuote, pendingIntent, pendingSizeUsd, signers, appendMessage]);

  const cancelConfirm = useCallback(() => {
    setPendingQuote(null);
    setPendingIntent(null);
    setPendingSizeUsd(null);
    setPhase("idle");
    appendMessage({ role: "assistant", text: "No problem — cancelled." });
  }, [appendMessage]);

  const reset = useCallback(() => {
    setPhase("idle");
    setPendingQuote(null);
    setPendingIntent(null);
    setPendingSizeUsd(null);
    setReceipt(null);
    setError(null);
  }, []);

  return {
    messages,
    phase,
    pendingQuote,
    receipt,
    error,
    submitText,
    confirmTrade,
    cancelConfirm,
    reset,
    canTrade: Boolean(ua && balance && balance.totalUsd > 0),
  };
}
