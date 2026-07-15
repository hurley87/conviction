"use client";

import Image from "next/image";
import { useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { DepositAddress } from "@/components/deposit-address";
import { AddMoneyButton } from "@/components/add-money-button";
import { WithdrawalHost } from "@/components/settings/withdrawal-host";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";
import { truncateAddress } from "@/lib/format";
import { IS_LIVE } from "@/lib/env";

export function SettingsView() {
  const account = useAccount();
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  if (!account.ready) {
    return <div className="h-64 animate-pulse rounded-2xl bg-zinc-100" />;
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500">Sign in to manage your settings.</p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} mt-6 px-8 py-3`}
        >
          Sign in with Twitter
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-bold text-zinc-900">Settings</h1>

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Account
        </h2>
        <div className="mt-4 flex items-center gap-4">
          {account.pfp ? (
            <Image
              src={account.pfp}
              alt=""
              width={48}
              height={48}
              className="rounded-full"
              unoptimized
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
              {account.handle?.slice(0, 2).toUpperCase() ?? "?"}
            </span>
          )}
          <div>
            <p className="font-semibold text-zinc-900">
              {account.handle ? `@${account.handle}` : "Account"}
            </p>
            {account.address && (
              <p className="text-xs font-mono text-zinc-400">
                {truncateAddress(account.address)}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Wallets
        </h2>
        <div className="mt-4">
          {account.deposits ? (
            <DepositAddress deposits={account.deposits} />
          ) : (
            <p className="text-sm text-zinc-400">Loading wallets…</p>
          )}
        </div>
        <div className="mt-4">
          {!withdrawOpen ? (
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              disabled={!account.ua}
              className={`${PRIMARY_LIGHT} w-full py-2.5 text-sm disabled:opacity-50`}
            >
              Withdraw
            </button>
          ) : (
            <WithdrawalHost onClose={() => setWithdrawOpen(false)} />
          )}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Wallet status
        </h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void account.upgrade()}
            disabled={account.upgraded}
            className={PRIMARY_LIGHT}
          >
            {account.upgraded ? "Wallet ready" : "Upgrade my wallet"}
          </button>
          <AddMoneyButton
            onAdd={account.addMoney}
            isFunding={account.isFunding}
          />
        </div>
        {account.fundingError && (
          <p className="mt-2 text-xs text-red-500">{account.fundingError}</p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Preferences
        </h2>
        <p className="mt-3 text-sm text-zinc-400">
          Notifications and theme settings coming soon.
        </p>
      </section>

      {IS_LIVE && (
        <button
          type="button"
          onClick={() => account.logout()}
          className={`${GHOST_LIGHT} mt-8 w-full py-3`}
        >
          Sign out
        </button>
      )}
    </div>
  );
}
