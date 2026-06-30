"use client";

// Plain-English concierge chat surface (issue #2). No chain/token jargon in
// the main flow — confirm card and receipt are separate surfaces.

import { useState } from "react";
import { useConciergeCore } from "@/hooks/use-concierge-core";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { ConfirmCard } from "@/components/confirm-card";
import { PostConviction } from "@/components/post-conviction";
import { ReceiptView } from "@/components/receipt-view";
import { PRIMARY } from "@/components/button-styles";
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
  const c = useConciergeCore(ua, balance, signers, handle);
  const [input, setInput] = useState("");

  const permalink =
    typeof window !== "undefined" && c.receipt
      ? `${window.location.origin}/r/${c.receipt.slug}`
      : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || c.phase === "executing" || c.phase === "quoting") return;
    setInput("");
    void c.submitText(text);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left backdrop-blur">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#6b7099]">
          Concierge
        </p>
        <ul className="mt-3 max-h-48 space-y-3 overflow-y-auto">
          {c.messages.map((m, i) => (
            <li
              key={`${m.role}-${i}`}
              className={
                m.role === "user"
                  ? "text-right text-sm text-white"
                  : "text-left text-sm text-[#aeb4d6]"
              }
            >
              {m.text}
            </li>
          ))}
        </ul>

        {c.phase !== "confirm" && c.phase !== "done" && (
          <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Move $25 to cash…"
              disabled={
                !c.canTrade || c.phase === "executing" || c.phase === "quoting"
              }
              className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-[#4a4f74] focus:border-[#6C7BFF]/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={
                !c.canTrade || c.phase === "executing" || c.phase === "quoting"
              }
              className={`${PRIMARY} px-5 py-2 text-sm`}
            >
              Send
            </button>
          </form>
        )}
      </div>

      {(c.phase === "confirm" || c.phase === "executing") && c.pendingQuote && (
        <ConfirmCard
          quote={c.pendingQuote}
          executing={c.phase === "executing"}
          onConfirm={() => void c.confirmTrade()}
          onCancel={c.cancelConfirm}
        />
      )}

      {c.phase === "done" && c.receipt && (
        <>
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
        </>
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
