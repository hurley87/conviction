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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="pt-eyebrow">One balance · every network</p>
          <h1 className="mt-2 font-display text-[clamp(2.5rem,5vw,4.25rem)] font-medium leading-[0.96] tracking-[-0.045em] text-ink">
            {greeting.text},
            <br className="sm:hidden" />{" "}
            <span className="italic text-brand">{name}</span>{" "}
            <span className="text-[0.6em] not-italic">{greeting.emoji}</span>
          </h1>
        </div>
        <button
          type="button"
          onClick={openBubble}
          className="group inline-flex w-fit items-center gap-2.5 rounded-full border border-line bg-surface/75 px-4 py-2.5 text-sm font-extrabold text-ink shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-brand-on transition-transform group-hover:rotate-6">
            ✦
          </span>
          Ask your agent
        </button>
      </div>

      <BalanceHeader
        totalUsd={account.balance?.totalUsd ?? null}
        loading={!account.balance}
      />

      <QuickActions />

      {hasHoldings ? (
        <AssetList sources={account.balance!.sources} />
      ) : (
        <div className="app-card flex flex-col items-center px-6 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-xl text-brand">
            +
          </span>
          <p className="mt-4 font-display text-2xl font-semibold text-ink">
            Your portfolio is ready for its first move.
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-3">
            Add money or send crypto to your universal account. Everything
            appears here as one spendable balance.
          </p>
        </div>
      )}
    </div>
  );
}
