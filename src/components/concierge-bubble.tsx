"use client";

// Intercom-style concierge launcher — a fixed circle top-right that toggles
// a floating chat panel. Panel stays mounted so chat state survives close.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount } from "@/components/account/account-context";
import { Concierge } from "@/components/concierge";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { useClickOutside } from "@/hooks/use-click-outside";
import { IS_LIVE } from "@/lib/env";

type ConciergeBubbleValue = {
  open: boolean;
  openBubble: () => void;
  closeBubble: () => void;
  toggle: () => void;
};

const ConciergeBubbleContext = createContext<ConciergeBubbleValue | null>(null);

export function ConciergeBubbleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openBubble = useCallback(() => setOpen(true), []);
  const closeBubble = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(
    () => ({ open, openBubble, closeBubble, toggle }),
    [open, openBubble, closeBubble, toggle],
  );
  return (
    <ConciergeBubbleContext.Provider value={value}>
      {children}
    </ConciergeBubbleContext.Provider>
  );
}

export function useConciergeBubble(): ConciergeBubbleValue {
  const ctx = useContext(ConciergeBubbleContext);
  if (!ctx) {
    throw new Error(
      "useConciergeBubble must be used within ConciergeBubbleProvider",
    );
  }
  return ctx;
}

function BubbleBody() {
  const account = useAccount();

  if (!account.ready) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <p className="text-sm text-zinc-600">
          Sign in to trade and get answers about your balance and the feed.
        </p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} px-6 py-2 text-sm`}
        >
          Sign in with Twitter
        </button>
      </div>
    );
  }

  if (!account.ua || !account.balance) {
    return (
      <p className="px-6 py-10 text-center text-sm text-zinc-500">
        Setting up your account…
      </p>
    );
  }

  return (
    <Concierge
      ua={account.ua}
      balance={account.balance}
      handle={account.handle}
    />
  );
}

export function ConciergeBubble() {
  const { open, closeBubble, toggle } = useConciergeBubble();
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, closeBubble, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBubble();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeBubble]);

  return (
    <div ref={containerRef} className="fixed right-8 top-6 z-50">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:scale-105 hover:bg-blue-700 active:scale-95"
      >
        {open ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 2c.4 0 .76.24.91.61l1.7 4.13c.25.6.73 1.08 1.33 1.33l4.13 1.7a.985.985 0 0 1 0 1.82l-4.13 1.7c-.6.25-1.08.73-1.33 1.33l-1.7 4.13a.985.985 0 0 1-1.82 0l-1.7-4.13a2.46 2.46 0 0 0-1.33-1.33l-4.13-1.7a.985.985 0 0 1 0-1.82l4.13-1.7c.6-.25 1.08-.73 1.33-1.33l1.7-4.13c.15-.37.51-.61.91-.61Z" />
            <path d="M19.5 15c.2 0 .38.12.45.3l.57 1.38c.12.3.36.54.66.66l1.38.57a.49.49 0 0 1 0 .9l-1.38.57c-.3.12-.54.36-.66.66l-.57 1.38a.49.49 0 0 1-.9 0l-.57-1.38a1.23 1.23 0 0 0-.66-.66l-1.38-.57a.49.49 0 0 1 0-.9l1.38-.57c.3-.12.54-.36.66-.66l.57-1.38a.49.49 0 0 1 .45-.3Z" />
          </svg>
        )}
      </button>

      <div
        aria-hidden={!open}
        className={`absolute right-0 top-full mt-3 flex max-h-[min(600px,calc(100vh-7rem))] w-[380px] origin-top-right flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl transition-all duration-200 ease-out ${
          open
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">Assistant</p>
          <button
            type="button"
            onClick={closeBubble}
            aria-label="Close"
            className="text-zinc-400 transition hover:text-zinc-600"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <BubbleBody />
      </div>
    </div>
  );
}
