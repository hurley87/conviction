"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAccount } from "@/components/account/account-context";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { useClickOutside } from "@/hooks/use-click-outside";

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(menuRef, close, open);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() =>
      firstItemRef.current?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!account.ready) {
    return (
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="h-8 w-8 animate-pulse rounded-full bg-surface-3" />
        <div className="h-4 w-24 animate-pulse rounded bg-surface-3" />
      </div>
    );
  }

  if (!account.authenticated) {
    return (
      <button
        type="button"
        onClick={() => account.login()}
        className={`${PRIMARY_LIGHT} w-full py-2 text-sm`}
      >
        Sign in with email or X
      </button>
    );
  }

  const handleLabel = account.handle ?? "Account";

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center rounded-[18px] border border-transparent text-left transition hover:border-line hover:bg-surface/70 hover:shadow-sm ${
          compact ? "gap-2.5 p-1.5" : "w-full gap-3 px-2 py-2.5"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {account.pfp ? (
          <Image
            src={account.pfp}
            alt=""
            width={compact ? 30 : 42}
            height={compact ? 30 : 42}
            className="shrink-0 rounded-full"
            unoptimized
          />
        ) : (
          <span
            className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-ink ${
              compact ? "h-[30px] w-[30px] text-xs" : "h-[42px] w-[42px] text-sm"
            }`}
            style={{ background: "var(--pt-grad-dawn)" }}
          >
            {account.handle?.slice(0, 1).toUpperCase() ?? "?"}
          </span>
        )}
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-ink">
                {handleLabel}
              </span>
              <span
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  account.upgraded
                    ? "bg-[#e5f1df] text-success"
                    : "bg-surface-3 text-ink-3"
                }`}
              >
                {account.upgraded ? "Wallet ready" : "Setup pending"}
              </span>
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`shrink-0 -rotate-90 text-ink-3 transition ${
                open ? "-translate-y-0.5" : ""
              }`}
              aria-hidden
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className={`absolute z-50 w-60 rounded-[20px] border border-line bg-surface/95 p-2 shadow-lg backdrop-blur-xl ${
            compact ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2"
          }`}
        >
          <Link
            ref={firstItemRef}
            href="/settings"
            role="menuitem"
            onClick={close}
            className="flex items-center gap-3 rounded-[14px] px-3 py-3 text-sm font-bold text-ink transition hover:bg-surface-2 focus:bg-surface-2"
          >
            <span aria-hidden className="text-lg">
              ⚙
            </span>
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              account.logout();
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left text-sm font-bold text-danger transition hover:bg-[#fff0ed] focus:bg-[#fff0ed]"
          >
            <span aria-hidden className="text-xl leading-none">
              ↪
            </span>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
