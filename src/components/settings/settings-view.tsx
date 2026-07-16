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
    return <div className="h-64 animate-pulse rounded-[28px] bg-surface-3" />;
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="py-16 text-center">
        <p className="text-ink-3">Sign in to manage your settings.</p>
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
    <div className="mx-auto max-w-5xl">
      <div>
        <p className="pt-eyebrow">Account, wallets, preferences</p>
        <h1 className="mt-2 font-display text-[clamp(3.2rem,7vw,5.8rem)] font-medium leading-[0.9] tracking-[-0.05em] text-ink">
          Make it <span className="italic text-brand">yours.</span>
        </h1>
      </div>

      <section className="relative mt-9 overflow-hidden rounded-[30px] border border-line bg-brand p-6 text-brand-on shadow-lg sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-36 h-80 w-96 rounded-full opacity-30 blur-[75px]"
          style={{ background: "var(--pt-grad-dawn)" }}
          aria-hidden
        />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            {account.pfp ? (
              <Image
                src={account.pfp}
                alt=""
                width={56}
                height={56}
                className="rounded-full ring-4 ring-white/10"
                unoptimized
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 font-display text-lg font-bold text-white">
                {account.handle?.slice(0, 2).toUpperCase() ?? "?"}
              </span>
            )}
            <div>
              <p className="font-display text-2xl font-semibold text-white">
                {account.handle ? `@${account.handle}` : "Account"}
              </p>
              {account.address && (
                <p className="mt-1 text-xs font-mono text-white/55">
                  {truncateAddress(account.address)}
                </p>
              )}
            </div>
          </div>
          <div className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-white/75">
            <span className="h-2 w-2 rounded-full bg-[#9de2a9]" />
            Universal account active
          </div>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="app-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="pt-eyebrow">Fund your account</p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
                Deposit addresses
              </h2>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-soft text-brand">
              ↓
            </span>
          </div>
          <div className="mt-5">
            {account.deposits ? (
              <DepositAddress deposits={account.deposits} />
            ) : (
              <p className="text-sm text-ink-4">Loading wallets…</p>
            )}
          </div>
          <div className="mt-5 border-t border-line pt-5">
            {!withdrawOpen ? (
              <button
                type="button"
                onClick={() => setWithdrawOpen(true)}
                disabled={!account.ua}
                className={`${GHOST_LIGHT} w-full py-2.5 text-sm disabled:opacity-50`}
              >
                Withdraw to another wallet
              </button>
            ) : (
              <WithdrawalHost onClose={() => setWithdrawOpen(false)} />
            )}
          </div>
        </section>

        <div className="grid gap-6">
          <section className="app-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="pt-eyebrow">Wallet status</p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
                  Ready for every move
                </h2>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#e5f1df] text-success">
                ✓
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-3">
              Your universal account handles supported networks through one
              address and one confirmation flow.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
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
              <p className="mt-2 text-xs text-danger">{account.fundingError}</p>
            )}
          </section>

          <section className="app-card p-6">
            <p className="pt-eyebrow">Preferences</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
              More control is coming
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-3">
              Notification controls and appearance settings are on the way.
              Conviction stays calm and focused by default.
            </p>
          </section>
        </div>
      </div>

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
