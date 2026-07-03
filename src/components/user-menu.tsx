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
        <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-200" />
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200" />
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
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-zinc-100"
        aria-expanded={open}
      >
        {account.pfp ? (
          <Image
            src={account.pfp}
            alt=""
            width={32}
            height={32}
            className="rounded-full"
            unoptimized
          />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
            {account.handle?.slice(0, 2).toUpperCase() ?? "?"}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
          {handleLabel}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`shrink-0 text-zinc-400 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Your wallets
          </p>
          {account.deposits ? (
            <DepositAddress deposits={account.deposits} />
          ) : (
            <p className="text-sm text-zinc-500">Loading wallets…</p>
          )}
          <div className="mt-4 border-t border-zinc-100 pt-3">
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
