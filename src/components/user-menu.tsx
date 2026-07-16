"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import { useAccount } from "@/components/account/account-context";
import { DepositAddress } from "@/components/deposit-address";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { useClickOutside } from "@/hooks/use-click-outside";

export function UserMenu() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(menuRef, close, open);

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
      <button type="button" onClick={() => account.login()} className={`${PRIMARY_LIGHT} w-full py-2 text-sm`}>
        Sign in with Twitter
      </button>
    );
  }

  const handleLabel = account.handle ? `@${account.handle}` : "Account";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-2xl px-2 py-2 text-left transition hover:bg-surface-3"
        aria-expanded={open}
      >
        {account.pfp ? (
          <Image
            src={account.pfp}
            alt=""
            width={30}
            height={30}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <span
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-xs font-extrabold text-ink"
            style={{ background: "var(--pt-grad-dawn)" }}
          >
            {account.handle?.slice(0, 1).toUpperCase() ?? "?"}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {handleLabel}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 text-ink-4 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-line bg-surface p-4 shadow-lg">
          <p className="pt-eyebrow mb-3">Your wallets</p>
          {account.deposits ? (
            <DepositAddress deposits={account.deposits} />
          ) : (
            <p className="text-sm text-ink-3">Loading wallets…</p>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => {
                account.logout();
                setOpen(false);
              }}
              className={`${GHOST_LIGHT} w-full py-2 text-sm`}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
