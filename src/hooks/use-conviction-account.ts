"use client";

// Orchestrates the live path: Privy auth → verified server profile → owner EOA
// → UA client → unified balance. The EOA is the
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
import type {
  InitializeUserBody,
  PatchUserBody,
} from "@/lib/user-profile-request";
import type { UserProfile } from "@/lib/users";

async function profileRequest(
  getAccessToken: () => Promise<string | null>,
  method: "POST" | "PATCH",
  body: InitializeUserBody | PatchUserBody,
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Your Privy session has expired. Sign in again.");
  const response = await fetch("/api/users", {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    profile?: UserProfile;
    error?: string;
  };
  if (!response.ok || !result.profile) {
    throw new Error(result.error ?? "Your profile could not be loaded.");
  }
  return result.profile;
}

export function useConvictionAccount() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { fundWallet } = useFundWallet();

  // Privy's useWallets() returns every connected wallet, including injected
  // browser extensions (MetaMask, etc.). We always want the embedded wallet
  // tied to the social login, not whichever extension happens to be connected.
  const address = getEmbeddedConnectedWallet(wallets)?.address;

  // One UA client per owner address — rebuilding it per call would throw away
  // the SDK account cache the Particle client builds lazily.
  const ua = useMemo(() => (address ? getUAClient(address) : null), [address]);

  const { balance, deposits, refresh } = useUASnapshot(ua);
  const [upgraded, setUpgraded] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const markUpgraded = useCallback(() => {
    setUpgraded(true);
  }, []);

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

  const retryProfile = useCallback(async () => {
    if (!authenticated || !address) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const next = await profileRequest(getAccessToken, "POST", { address });
      setProfile(next);
    } catch (error) {
      setProfile(null);
      setProfileError(
        error instanceof Error ? error.message : "Your profile could not be loaded.",
      );
    } finally {
      setProfileLoading(false);
    }
  }, [address, authenticated, getAccessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!authenticated) {
        setProfile(null);
        setProfileError(null);
        setProfileLoading(false);
        return;
      }
      if (!address) {
        setProfileLoading(true);
        return;
      }
      void retryProfile();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [address, authenticated, retryProfile]);

  const saveHandle = useCallback(
    async (handle: string) => {
      const next = await profileRequest(getAccessToken, "PATCH", {
        action: "saveHandle",
        handle,
      });
      setProfile(next);
    },
    [getAccessToken],
  );

  const completeOnboarding = useCallback(async () => {
    // Replaying the tour must not rewrite an existing completion timestamp.
    if (!profile?.onboardingRequired) return;
    const next = await profileRequest(getAccessToken, "PATCH", {
      action: "completeOnboarding",
    });
    setProfile(next);
  }, [getAccessToken, profile]);

  const upgrade = useCallback(async () => {
    if (!ua) return;
    await ua.ensureUpgraded();
    setUpgraded(true);
    await refresh();
  }, [ua, refresh]);

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
    profileReady: !authenticated || (!profileLoading && Boolean(profile)),
    profileError,
    profileId: profile?.privyId ?? null,
    login,
    logout,
    getAccessToken,
    retryProfile,
    handle: profile?.handle ?? null,
    email: profile?.email ?? null,
    identitySource: profile?.identitySource ?? null,
    needsOnboarding: Boolean(profile?.onboardingRequired),
    saveHandle,
    completeOnboarding,
    address,
    balance,
    deposits,
    addMoney,
    isFunding,
    fundingError,
    upgrade,
    upgraded,
    markUpgraded,
    refreshBalance: refresh,
  };
}
