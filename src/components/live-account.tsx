"use client";

// Live onboarding + unified-balance panel (Privy + Particle UA). Rendered only
// when NEXT_PUBLIC_PRIVY_APP_ID is set; otherwise MockAccount is used.

import { useConvictionAccount } from "@/hooks/use-conviction-account";
import { BalanceCard } from "@/components/balance-card";
import { DepositAddress } from "@/components/deposit-address";
import { PRIMARY, GHOST } from "@/components/button-styles";

export function LiveAccount() {
  const a = useConvictionAccount();

  if (!a.ready) {
    return <p className="text-sm text-[#6b7099]">Loading…</p>;
  }

  if (!a.authenticated) {
    return (
      <button type="button" onClick={() => a.login()} className={PRIMARY}>
        Sign in with Twitter
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {a.handle && (
        <p className="text-sm text-[#aeb4d6]">
          Signed in as <span className="font-semibold text-white">@{a.handle}</span>
        </p>
      )}
      <BalanceCard totalUsd={a.balance?.totalUsd ?? null} loading={!a.balance} />
      {a.address && <DepositAddress address={a.address} />}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => a.upgrade()}
          disabled={a.upgraded}
          className={PRIMARY}
        >
          {a.upgraded ? "Wallet ready" : "Upgrade my wallet"}
        </button>
        <button type="button" onClick={() => a.logout()} className={GHOST}>
          Sign out
        </button>
      </div>
    </div>
  );
}
