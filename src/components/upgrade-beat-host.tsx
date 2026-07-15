"use client";

// Owns the upgrade-in-place beat (issue #19). Keeps beat UI out of AccountContext
// and the UA transport — reveal only when the account is actually upgraded.

import { useAccount } from "@/components/account/account-context";
import { UpgradeBeat } from "@/components/upgrade-beat";
import { useUpgradeBeat } from "@/hooks/use-upgrade-beat";

export function UpgradeBeatHost() {
  const { address, authenticated, balance, upgraded } = useAccount();
  const { showUpgradeBeat, dismissUpgradeBeat } = useUpgradeBeat(
    address,
    authenticated && upgraded,
  );

  if (!showUpgradeBeat || !address) return null;

  return (
    <UpgradeBeat
      address={address}
      balanceUsd={balance?.totalUsd ?? null}
      onDismiss={dismissUpgradeBeat}
    />
  );
}
