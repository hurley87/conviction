"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "@/components/account/account-context";
import { useConciergeBubble } from "@/components/concierge-bubble";
import { BalanceHeader } from "@/components/home/balance-header";
import { QuickActions } from "@/components/home/quick-actions";
import { AssetList } from "@/components/home/asset-list";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { IS_LIVE } from "@/lib/env";

/** Time-of-day greeting. Hour is null until mounted (server render) so SSR and
 * the first client render agree — then the client's local hour tunes it. */
function greetingFor(hour: number | null): { text: string; emoji: string } {
  if (hour == null) return { text: "Welcome back", emoji: "" };
  if (hour < 5) return { text: "Still up", emoji: "🌙" };
  if (hour < 12) return { text: "Good morning", emoji: "☀️" };
  if (hour < 18) return { text: "Good afternoon", emoji: "🌤️" };
  return { text: "Good evening", emoji: "🌙" };
}

const NOOP_SUBSCRIBE = () => () => {};

/** Local-clock hour, read only after hydration (null on the server). */
function useClientHour(): number | null {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => new Date().getHours(),
    () => null,
  );
}

export function HomeDashboard() {
  const account = useAccount();
  const { openBubble } = useConciergeBubble();
  const greeting = greetingFor(useClientHour());

  if (!account.ready) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <div className="h-40 w-full animate-pulse rounded-hero bg-surface-3" />
        <div className="h-20 w-full animate-pulse rounded-card bg-surface-3" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="font-display text-3xl font-semibold text-ink">
          Welcome to Conviction
        </h1>
        <p className="mt-3 max-w-md text-ink-3">
          Sign in with Twitter to view your unified balance and trade across
          chains.
        </p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} mt-8 px-8 py-3`}
        >
          Sign in with Twitter
        </button>
      </div>
    );
  }

  const name = account.handle ? `@${account.handle}` : "there";
  const hasHoldings =
    !!account.balance && account.balance.sources.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[26px] font-medium text-ink">
          {greeting.text}, {name} {greeting.emoji}
        </h1>
        <button
          type="button"
          onClick={openBubble}
          title="Ask Conviction"
          aria-label="Ask Conviction"
          className="grid h-[42px] w-[42px] place-items-center rounded-full bg-brand text-brand-on shadow-md transition hover:bg-brand-hover"
        >
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
          >
            <path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.37-4.1-1.02L3 21l1.52-5.4A8.5 8.5 0 1 1 21 12Z" />
          </svg>
        </button>
      </div>

      <BalanceHeader
        totalUsd={account.balance?.totalUsd ?? null}
        loading={!account.balance}
      />

      <QuickActions />

      {hasHoldings && <AssetList sources={account.balance!.sources} />}
    </div>
  );
}
