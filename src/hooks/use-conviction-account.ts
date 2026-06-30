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
  useFundWallet,
} from "@privy-io/react-auth";
import { getUAClient } from "@/lib/ua";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { FUNDING_TARGET } from "@/lib/funding";

export function useConvictionAccount() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();

  // Privy's useWallets() returns every connected wallet, including injected
  // browser extensions (MetaMask, etc.). We always want the embedded wallet
  // tied to the social login, not whichever extension happens to be connected.
  const address = getEmbeddedConnectedWallet(wallets)?.address;
  const handle = user?.twitter?.username ?? null;

  // One UA client per owner address — rebuilding it per call would throw away
  // the SDK account cache the Particle client builds lazily.
  const ua = useMemo(() => (address ? getUAClient(address) : null), [address]);

  const { balance, deposits, refresh } = useUASnapshot(ua);
  const [upgraded, setUpgraded] = useState(false);
  const [isFunding, setIsFunding] = useState(false);

  // On connect: persist the user's Twitter handle (ADR 0009).
  useEffect(() => {
    if (!authenticated || !address || !handle || !user?.id) return;
    void fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ privyId: user.id, handle, address }),
    }).catch(() => {});
  }, [authenticated, address, handle, user?.id]);

  const upgrade = useCallback(async () => {
    if (!ua) return;
    await ua.ensureUpgraded();
    setUpgraded(true);
    await refresh();
  }, [ua, refresh]);

  const addMoney = useCallback(async () => {
    if (!address) return;
    setIsFunding(true);
    try {
      await fundWallet({
        address,
        options: {
          chain: { id: FUNDING_TARGET.chainId },
          asset: FUNDING_TARGET.asset,
          defaultFundingMethod: "card",
        },
      });
      await refresh();
    } finally {
      setIsFunding(false);
    }
  }, [address, fundWallet, refresh]);

  return {
    ready,
    authenticated,
    login,
    logout,
    handle,
    address,
    balance,
    deposits,
    addMoney,
    isFunding,
    upgrade,
    upgraded,
  };
}
