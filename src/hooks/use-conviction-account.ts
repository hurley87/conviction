"use client";

// Orchestrates the live path: Privy auth → owner EOA → UA client → unified
// balance, and persists the user's Twitter handle (ADR 0009). The EOA is the
// Universal Account in 7702 mode (same address); the on-chain 7702 authorization
// signature is submitted with the first trade (issue #2). Pending Particle
// confirmation of the delegate-contract details (docs/adr/0000).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePrivy,
  useWallets,
  getEmbeddedConnectedWallet,
} from "@privy-io/react-auth";
import { getUAClient } from "@/lib/ua";
import type { UniversalBalance } from "@/lib/verbs/types";

export function useConvictionAccount() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();

  // Privy's useWallets() returns every connected wallet, including injected
  // browser extensions (MetaMask, etc.). We always want the embedded wallet
  // tied to the social login, not whichever extension happens to be connected.
  const address = getEmbeddedConnectedWallet(wallets)?.address;
  const handle = user?.twitter?.username ?? null;

  // One UA client per owner address — rebuilding it per call would throw away
  // the SDK account cache the Particle client builds lazily.
  const ua = useMemo(() => (address ? getUAClient(address) : null), [address]);

  const [balance, setBalance] = useState<UniversalBalance | null>(null);
  const [upgraded, setUpgraded] = useState(false);

  const refresh = useCallback(async () => {
    if (!ua) return;
    // await first so this never setStates synchronously inside an effect.
    const next = await ua.getUniversalBalance();
    setBalance(next);
  }, [ua]);

  // On connect: persist identity and load the unified balance. setState lives
  // in the promise callback (async), not synchronously in the effect body.
  useEffect(() => {
    if (!authenticated || !ua || !address) return;
    if (handle && user?.id) {
      void fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ privyId: user.id, handle, address }),
      }).catch(() => {});
    }
    let active = true;
    ua.getUniversalBalance()
      .then((next) => {
        if (active) setBalance(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [authenticated, ua, address, handle, user?.id]);

  const upgrade = useCallback(async () => {
    if (!ua) return;
    await ua.ensureUpgraded();
    setUpgraded(true);
    await refresh();
  }, [ua, refresh]);

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
