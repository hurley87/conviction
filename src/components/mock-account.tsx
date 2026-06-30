"use client";

// Local-dev / zero-credential panel. Drives the mock UA client so the unified
// balance and the upgrade action are demoable without Privy/Particle keys
// (ADR 0014). Replaced by LiveAccount once NEXT_PUBLIC_PRIVY_APP_ID is set.

import { useEffect, useMemo, useState } from "react";
import { MockUAClient } from "@/lib/ua/mock";
import { BalanceCard } from "@/components/balance-card";
import { Concierge } from "@/components/concierge";
import { PRIMARY } from "@/components/button-styles";
import type { UniversalBalance } from "@/lib/verbs/types";

export function MockAccount() {
  const ua = useMemo(() => new MockUAClient(), []);
  const [balance, setBalance] = useState<UniversalBalance | null>(null);
  const [upgraded, setUpgraded] = useState(false);

  useEffect(() => {
    void ua.getUniversalBalance().then(setBalance);
  }, [ua]);

  return (
    <div className="flex flex-col items-center gap-6">
      <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[#6b7099]">
        Demo mode
      </span>
      <BalanceCard totalUsd={balance?.totalUsd ?? null} loading={!balance} />
      {balance && <Concierge ua={ua} balance={balance} />}
      <button
        type="button"
        onClick={async () => {
          await ua.ensureUpgraded();
          setUpgraded(true);
        }}
        disabled={upgraded}
        className={PRIMARY}
      >
        {upgraded ? "Wallet ready" : "Upgrade my wallet"}
      </button>
      <p className="max-w-xs text-center text-xs text-[#4a4f74]">
        Set <code>NEXT_PUBLIC_PRIVY_APP_ID</code> and the Particle keys to enable
        real Twitter sign-in and balances.
      </p>
    </div>
  );
}
