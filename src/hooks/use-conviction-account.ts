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
import {
  UPGRADE_IN_PLACE_EVENT,
  markUpgradeBeatSeen,
  shouldRevealUpgradeBeat,
} from "@/lib/upgrade-beat";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [showUpgradeBeat, setShowUpgradeBeat] = useState(false);

  const tryRevealUpgradeBeat = useCallback((addr: string | undefined) => {
    const storage = browserStorage();
    if (!storage || !shouldRevealUpgradeBeat(addr, storage)) return;
    setShowUpgradeBeat(true);
  }, []);

  const dismissUpgradeBeat = useCallback(() => {
    const storage = browserStorage();
    if (address && storage) {
      markUpgradeBeatSeen(address, storage);
    }
    setShowUpgradeBeat(false);
  }, [address]);

  // Reflect the account's real on-chain 7702 status, so "Wallet ready" survives
  // reloads instead of resetting to "Upgrade my wallet" every load.
  useEffect(() => {
    if (!authenticated || !address) return;
    let cancelled = false;
    void fetch(`/api/wallet-status?address=${address}`)
      .then((r) => r.json())
      .then((d: { upgraded?: boolean }) => {
        if (!cancelled && d.upgraded) setUpgraded(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authenticated, address]);

  // Demo beat: show once after login when we have an address (issue #19).
  useEffect(() => {
    if (!authenticated || !address) {
      setShowUpgradeBeat(false);
      return;
    }
    tryRevealUpgradeBeat(address);
  }, [authenticated, address, tryRevealUpgradeBeat]);

  // First-tx path: Particle emits when 7702 auth was actually signed.
  useEffect(() => {
    if (!authenticated || !address) return;
    const onUpgraded = () => {
      setUpgraded(true);
      tryRevealUpgradeBeat(address);
    };
    window.addEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    return () => {
      window.removeEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    };
  }, [authenticated, address, tryRevealUpgradeBeat]);

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
    tryRevealUpgradeBeat(address);
    await refresh();
  }, [ua, refresh, tryRevealUpgradeBeat, address]);

  const addMoney = useCallback(async () => {
    if (!address) return;
    setFundingError(null);
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
    } catch (err) {
      // Privy throws e.g. "Wallet funding is not enabled" when the onramp is
      // misconfigured; surface it instead of an uncaught rejection.
      setFundingError(
        err instanceof Error ? err.message : "Could not start funding.",
      );
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
    fundingError,
    upgrade,
    upgraded,
    showUpgradeBeat,
    dismissUpgradeBeat,
  };
}
