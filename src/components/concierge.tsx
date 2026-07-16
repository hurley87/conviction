"use client";

// Plain-English concierge chat surface (issue #2). No chain/token jargon in
// the main flow — confirm card and receipt are separate surfaces. Renders
// inside the ConciergeBubble panel, which owns the card chrome and header.

import { useEffect, useRef, useState } from "react";
import { useConciergeCore } from "@/hooks/use-concierge-core";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { useAccount } from "@/components/account/account-context";
import { ConfirmCard } from "@/components/confirm-card";
import { PostConviction } from "@/components/post-conviction";
import { ReceiptView } from "@/components/receipt-view";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { IS_LIVE } from "@/lib/env";
import type { UAClient } from "@/lib/ua";
import { mockTradeSigners } from "@/lib/ua/mock";
import type { TradeSigners, UniversalBalance } from "@/lib/verbs/types";

function ConciergePanel({
  ua,
  balance,
  signers,
  handle,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  signers: TradeSigners;
  handle: string | null;
}) {
  const { markUpgraded } = useAccount();
  const c = useConciergeCore(ua, balance, signers, handle, markUpgraded);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const permalink =
    typeof window !== "undefined" && c.receipt
      ? `${window.location.origin}/r/${c.receipt.slug}`
      : undefined;

  const inputDisabled = c.phase === "executing" || c.phase === "quoting";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.messages.length, c.phase]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || inputDisabled) return;
    setInput("");
    void c.submitText(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        {c.messages.map((m, i) => (
          <p
            key={`${m.role}-${i}`}
            className={
              m.role === "user"
                ? "ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-md bg-brand px-3.5 py-2.5 text-sm leading-relaxed text-brand-on shadow-sm"
                : "mr-auto w-fit max-w-[88%] rounded-[18px] rounded-bl-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-ink-2"
            }
          >
            {m.text}
          </p>
        ))}

        {(c.phase === "confirm" || c.phase === "executing") &&
          c.pendingQuote && (
            <div className="pt-1">
              <ConfirmCard
                quote={c.pendingQuote}
                executing={c.phase === "executing"}
                onConfirm={() => void c.confirmTrade()}
                onCancel={c.cancelConfirm}
              />
            </div>
          )}

        {c.phase === "done" && c.receipt && (
          <div className="space-y-2 pt-1">
            <ReceiptView
              receipt={c.receipt}
              permalink={permalink}
              onDismiss={c.reset}
            />
            {handle && (
              <PostConviction
                onPost={c.postConviction}
                onSkip={c.skipConviction}
                posting={c.convictionPhase === "posting"}
                posted={c.convictionPhase === "posted"}
              />
            )}
          </div>
        )}
      </div>

      {c.phase !== "confirm" && c.phase !== "done" && (
        <form
          onSubmit={handleSubmit}
          className="flex gap-2 border-t border-line bg-surface-2/50 p-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Move $25 to cash… or summarize the feed"
            disabled={inputDisabled}
            className="app-input min-w-0 flex-1 rounded-full px-4 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={inputDisabled}
            className={`${PRIMARY_LIGHT} px-4 py-2 text-sm`}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}

/** Live path — Privy signers for 7702 + root hash. */
export function LiveConcierge({
  ua,
  balance,
  handle,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  handle: string | null;
}) {
  const signers = useLiveTradeSigners();
  return (
    <ConciergePanel ua={ua} balance={balance} signers={signers} handle={handle} />
  );
}

/** Mock/demo path — no Privy hooks (ADR 0014). */
export function Concierge({
  ua,
  balance,
  handle = "demo-trader",
}: {
  ua: UAClient;
  balance: UniversalBalance;
  handle?: string | null;
}) {
  if (IS_LIVE) {
    return <LiveConcierge ua={ua} balance={balance} handle={handle} />;
  }
  return (
    <ConciergePanel
      ua={ua}
      balance={balance}
      signers={mockTradeSigners}
      handle={handle}
    />
  );
}
