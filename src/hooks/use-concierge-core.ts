"use client";

// Core concierge state machine — no Privy dependency (ADR 0014 mock path).

import { useCallback, useState } from "react";
import type { UAClient } from "@/lib/ua";
import {
  isFeedSummaryRequest,
  type FeedSummary,
} from "@/lib/verbs/feed-summary";
import {
  parseIntentHeuristic,
  pickSettlementChain,
  validateIntent,
} from "@/lib/verbs/intent";
import { generateReceiptSlug } from "@/lib/verbs/receipt";
import { tradeToConvictionTrade } from "@/lib/verbs/conviction";
import {
  FloorAbortError,
  type ParseResult,
  type Receipt,
  type TradeIntent,
  type TradeQuote,
  type TradeSigners,
  type UniversalBalance,
} from "@/lib/verbs/types";

/**
 * Parse text via the server LLM endpoint, falling back to the deterministic
 * parser if the request fails — so a gateway outage never blocks a trade.
 */
async function parseText(text: string): Promise<ParseResult> {
  try {
    const res = await fetch("/api/parse-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error("parse failed");
    return (await res.json()) as ParseResult;
  } catch {
    return parseIntentHeuristic(text);
  }
}

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

export type ConvictionPhase = "idle" | "posting" | "posted";

export function useConciergeCore(
  ua: UAClient | null,
  balance: UniversalBalance | null,
  signers: TradeSigners,
  handle: string | null,
  onUpgraded?: () => void,
) {
  const [messages, setMessages] = useState<ConciergeMessage[]>([
    {
      role: "assistant",
      text: 'What would you like to do? For example: "Move $25 to cash", "Convert half my ETH to cash", or "Summarize the feed".',
    },
  ]);
  const [phase, setPhase] = useState<ConciergePhase>("idle");
  const [pendingQuote, setPendingQuote] = useState<TradeQuote | null>(null);
  const [pendingIntent, setPendingIntent] = useState<TradeIntent | null>(null);
  const [pendingSizeUsd, setPendingSizeUsd] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarifyContext, setClarifyContext] = useState<string | null>(null);
  const [convictionPhase, setConvictionPhase] =
    useState<ConvictionPhase>("idle");

  const appendMessage = useCallback((msg: ConciergeMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const summarizeFeed = useCallback(async () => {
    setError(null);
    appendMessage({ role: "assistant", text: "Reading the feed…" });
    try {
      const res = await fetch("/api/summarize-feed");
      if (!res.ok) throw new Error("Couldn't read the feed.");
      const data = (await res.json()) as FeedSummary;
      appendMessage({ role: "assistant", text: data.digest });
      if (data.flaggedEntries.length > 0) {
        const lines = data.flaggedEntries
          .map((f) => `@${f.handle} — ${f.reason}`)
          .join("\n");
        appendMessage({
          role: "assistant",
          text: `Worth a closer look:\n${lines}`,
        });
      }
      setPhase("idle");
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Couldn't summarize the feed.";
      setPhase("error");
      setError(msg);
      appendMessage({ role: "assistant", text: msg });
    }
  }, [appendMessage]);

  const submitText = useCallback(
    async (text: string) => {
      setError(null);
      appendMessage({ role: "user", text });

      if (isFeedSummaryRequest(text)) {
        await summarizeFeed();
        return;
      }

      if (!ua || !balance) return;

      // A clarifying reply (e.g. "half") only makes sense alongside the original
      // request (e.g. "buy ETH") — carry the prior text forward and re-parse.
      const combined = clarifyContext ? `${clarifyContext} ${text}` : text;
      const parsed = await parseText(combined);
      if (parsed.kind === "clarify") {
        setClarifyContext(combined);
        setPhase("clarify");
        appendMessage({ role: "assistant", text: parsed.question });
        return;
      }
      setClarifyContext(null);

      // Settle where the funds already are so a buy doesn't bridge (cash stays
      // on Arbitrum, ADR 0005).
      const intent = {
        ...parsed.intent,
        destChain: pickSettlementChain(parsed.intent.toAsset, balance),
      };
      const validation = validateIntent(intent, balance);
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
    [ua, balance, appendMessage, clarifyContext, summarizeFeed],
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
      setConvictionPhase("idle");
      appendMessage({ role: "assistant", text: result.summary });
      if (result.signed7702Auth) {
        onUpgraded?.();
      }

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
            amountUsd: pendingSizeUsd,
            receiptSlug: slug,
          }),
        }).catch(() => {});
      }
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
  }, [
    ua,
    pendingQuote,
    pendingIntent,
    pendingSizeUsd,
    signers,
    appendMessage,
    handle,
    onUpgraded,
  ]);

  const cancelConfirm = useCallback(() => {
    setPendingQuote(null);
    setPendingIntent(null);
    setPendingSizeUsd(null);
    setClarifyContext(null);
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
    setClarifyContext(null);
    setConvictionPhase("idle");
  }, []);

  const postConviction = useCallback(
    async (thesis: string) => {
      if (
        !handle ||
        !pendingIntent ||
        pendingSizeUsd == null ||
        !receipt ||
        !pendingQuote
      ) {
        return;
      }

      const trimmed = thesis.trim();
      if (!trimmed) return;

      setConvictionPhase("posting");
      const trade = tradeToConvictionTrade(
        pendingIntent,
        pendingQuote,
        pendingSizeUsd,
        receipt,
      );

      try {
        const res = await fetch("/api/convictions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            handle,
            thesis: trimmed,
            trade,
            receiptSlug: receipt.slug,
          }),
        });
        if (!res.ok) {
          throw new Error("Failed to post conviction");
        }
        setConvictionPhase("posted");
        appendMessage({
          role: "assistant",
          text: "Your conviction is live on the feed.",
        });
      } catch {
        setConvictionPhase("idle");
        appendMessage({
          role: "assistant",
          text: "Couldn't post your conviction — try again from the feed later.",
        });
      }
    },
    [
      handle,
      pendingIntent,
      pendingSizeUsd,
      receipt,
      pendingQuote,
      appendMessage,
    ],
  );

  const skipConviction = useCallback(() => {
    reset();
  }, [reset]);

  return {
    messages,
    phase,
    pendingQuote,
    receipt,
    error,
    convictionPhase,
    submitText,
    summarizeFeed,
    confirmTrade,
    cancelConfirm,
    reset,
    postConviction,
    skipConviction,
    canTrade: Boolean(ua && balance && balance.totalUsd > 0),
    canPostConviction: Boolean(
      handle && phase === "done" && receipt && convictionPhase !== "posted",
    ),
  };
}
