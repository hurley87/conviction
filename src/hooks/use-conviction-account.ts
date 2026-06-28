"use client";

// Orchestrates the live path: Privy auth → owner EOA → UA client → unified
// balance, and persists the user's Twitter handle (ADR 0009). The EOA is the
// Universal Account in 7702 mode (same address); the on-chain 7702 authorization
// signature is submitted with the first trade (issue #2). Pending Particle
// confirmation of the delegate-contract details (docs/adr/0000).

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { getUAClient } from "@/lib/ua";
import type { UniversalBalance } from "@/lib/verbs/types";

export function useConvictionAccount() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  const address = wallets[0]?.address;
  const handle = user?.twitter?.username ?? null;

  const [balance, setBalance] = useState<UniversalBalance | null>(null);
  const [upgraded, setUpgraded] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    // await first so this never setStates synchronously inside an effect.
    const next = await getUAClient(address).getUniversalBalance();
    setBalance(next);
  }, [address]);

  // On connect: persist identity and load the unified balance. setState lives
  // in the promise callback (async), not synchronously in the effect body.
  useEffect(() => {
    if (!authenticated || !address) return;
    if (handle && user?.id) {
      void fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privyId: user.id, handle, address }),
      }).catch(() => {});
    }
    let active = true;
    getUAClient(address)
      .getUniversalBalance()
      .then((next) => {
        if (active) setBalance(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [authenticated, address, handle, user?.id]);

  const upgrade = useCallback(async () => {
    if (!address) return;
    await getUAClient(address).ensureUpgraded();
    setUpgraded(true);
    await refresh();
  }, [address, refresh]);

  return {
    ready,
    authenticated,
    login,
    logout,
    handle,
    address,
    balance,
    upgrade,
    upgraded,
  };
}
