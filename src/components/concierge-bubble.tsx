"use client";

// Icon launcher + full-height concierge drawer. The drawer stays mounted so
// chat and transaction state survive close/reopen.

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

function BubbleBody({ active }: { active: boolean }) {
  const account = useAccount();

  if (!account.ready) {
    return (
      <div className="space-y-3 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-surface-3" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <p className="text-sm text-ink-2">
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
      <p className="px-6 py-10 text-center text-sm text-ink-3">
        Setting up your account…
      </p>
    );
  }

  return (
    <Concierge
      ua={account.ua}
      balance={account.balance}
      handle={account.handle}
      active={active}
    />
  );
}

export function ConciergeBubble() {
  const { open, closeBubble, toggle } = useConciergeBubble();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeRef.current?.focus(),
    );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeBubble();
        return;
      }
      if (e.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.tabIndex >= 0);
      if (focusable.length === 0) {
        e.preventDefault();
        drawerRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeBubble]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      window.requestAnimationFrame(() => launcherRef.current?.focus());
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="conviction-chat-drawer"
        aria-label={open ? "Close assistant" : "Open assistant"}
        title="Ask Conviction"
        className="group fixed bottom-24 right-5 z-40 grid h-13 w-13 place-items-center rounded-full bg-brand text-brand-on shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-xl active:translate-y-0 motion-reduce:transition-none lg:bottom-7 lg:right-8"
      >
        <svg
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.8 9.8 0 0 1-4-.8L3 21l1.7-4.4A8.5 8.5 0 1 1 21 11.5Z" />
        </svg>
        <span className="pointer-events-none absolute right-0 top-full mt-2 hidden whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-bold text-white opacity-0 shadow-md transition group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
          Ask Conviction
        </span>
      </button>

      <div
        className={`fixed inset-0 z-50 ${
          open ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          aria-hidden
          onMouseDown={closeBubble}
          className={`absolute inset-0 bg-[var(--pt-overlay)] backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <section
          ref={drawerRef}
          id="conviction-chat-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conviction-chat-title"
          aria-hidden={!open}
          inert={!open}
          tabIndex={-1}
          className={`absolute inset-y-0 right-0 flex h-dvh w-full flex-col overflow-hidden border-l border-line bg-surface/98 shadow-[0_0_80px_rgba(42,26,46,0.22)] backdrop-blur-2xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:w-[420px] ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface/90 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--pt-grad-dawn)] text-ink shadow-sm">
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.8 9.8 0 0 1-4-.8L3 21l1.7-4.4A8.5 8.5 0 1 1 21 11.5Z" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2
                  id="conviction-chat-title"
                  className="truncate text-base font-extrabold text-ink"
                >
                  Ask Conviction
                </h2>
                <p className="truncate text-xs text-ink-4">
                  Thinks out loud, never advises
                </p>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={closeBubble}
              aria-label="Close chat"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink"
            >
              <svg
                width="19"
                height="19"
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
          </header>
          <div className="flex min-h-0 flex-1 flex-col">
            <BubbleBody active={open} />
          </div>
        </section>
      </div>
    </>
  );
}
