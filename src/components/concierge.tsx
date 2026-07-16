"use client";

// Plain-English concierge chat surface (issue #2). No chain/token jargon in
// the main flow — confirm card and receipt are separate surfaces. Renders
// inside the ConciergeBubble panel, which owns the card chrome and header.

import { useEffect, useRef, useState } from "react";
import { useConciergeCore } from "@/hooks/use-concierge-core";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
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
  active,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  signers: TradeSigners;
  handle: string | null;
  active: boolean;
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
  const composerVisible = c.phase !== "confirm" && c.phase !== "done";
  const speech = useSpeechRecognition({
    draft: input,
    enabled: active && composerVisible && !inputDisabled,
    onDraftChange: setInput,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [c.messages.length, c.phase]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || inputDisabled) return;
    speech.cancel();
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

      {composerVisible && (
        <div className="border-t border-line bg-surface-2/80 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                speech.clearError();
              }}
              placeholder={
                speech.listening
                  ? "Listening…"
                  : "Move $25 to cash… or summarize the feed"
              }
              disabled={inputDisabled}
              readOnly={speech.listening}
              aria-describedby={speech.error ? "speech-input-error" : undefined}
              className="app-input min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm"
            />
            {speech.supported && (
              <button
                type="button"
                onClick={speech.toggle}
                disabled={inputDisabled}
                aria-label={
                  speech.listening ? "Stop dictation" : "Start dictation"
                }
                aria-pressed={speech.listening}
                title={
                  speech.listening ? "Stop dictation" : "Speak to type"
                }
                className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full border transition disabled:pointer-events-none disabled:opacity-50 ${
                  speech.listening
                    ? "border-danger/30 bg-danger text-white shadow-[0_0_0_5px_rgba(181,64,47,0.12)]"
                    : "border-line-strong bg-surface text-ink-2 shadow-sm hover:border-brand/30 hover:text-brand"
                }`}
              >
                {speech.listening && (
                  <span
                    className="absolute inset-0 animate-ping rounded-full bg-danger/20 motion-reduce:animate-none"
                    aria-hidden
                  />
                )}
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="relative"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              disabled={inputDisabled || !input.trim()}
              className={`${PRIMARY_LIGHT} px-4 py-2.5 text-sm`}
            >
              Send
            </button>
          </form>
          {speech.error && (
            <p
              id="speech-input-error"
              role="status"
              className="px-2 pt-2 text-xs leading-relaxed text-danger"
            >
              {speech.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Live path — Privy signers for 7702 + root hash. */
export function LiveConcierge({
  ua,
  balance,
  handle,
  active,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  handle: string | null;
  active: boolean;
}) {
  const signers = useLiveTradeSigners();
  return (
    <ConciergePanel
      ua={ua}
      balance={balance}
      signers={signers}
      handle={handle}
      active={active}
    />
  );
}

/** Mock/demo path — no Privy hooks (ADR 0014). */
export function Concierge({
  ua,
  balance,
  handle = "demo-trader",
  active = true,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  handle?: string | null;
  active?: boolean;
}) {
  if (IS_LIVE) {
    return (
      <LiveConcierge
        ua={ua}
        balance={balance}
        handle={handle}
        active={active}
      />
    );
  }
  return (
    <ConciergePanel
      ua={ua}
      balance={balance}
      signers={mockTradeSigners}
      handle={handle}
      active={active}
    />
  );
}
