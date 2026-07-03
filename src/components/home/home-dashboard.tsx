"use client";

import { useAccount } from "@/components/account/account-context";
import { BalanceHeader } from "@/components/home/balance-header";
import { QuickActions } from "@/components/home/quick-actions";
import { AssetList } from "@/components/home/asset-list";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { IS_LIVE } from "@/lib/env";

export function HomeDashboard() {
  const account = useAccount();

  if (!account.ready) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <div className="h-40 w-full animate-pulse rounded-2xl bg-zinc-100" />
      </div>
    );
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-3xl font-bold text-zinc-900">Welcome to Conviction</h1>
        <p className="mt-3 max-w-md text-zinc-500">
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <h1 className="text-3xl font-bold text-zinc-900">Home</h1>
      <BalanceHeader
        totalUsd={account.balance?.totalUsd ?? null}
        loading={!account.balance}
      />
      <QuickActions />
      {account.balance && account.balance.sources.length > 0 && (
        <AssetList
          sources={account.balance.sources}
          totalUsd={account.balance.totalUsd}
        />
      )}
    </div>
  );
}
