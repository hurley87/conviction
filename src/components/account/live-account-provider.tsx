"use client";

import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  AccountContextProvider,
  type AccountContextValue,
} from "@/components/account/account-context";
import { useConvictionAccount } from "@/hooks/use-conviction-account";
import { getUAClient } from "@/lib/ua";

export function LiveAccountProvider({ children }: { children: React.ReactNode }) {
  const account = useConvictionAccount();
  const { user } = usePrivy();

  const ua = useMemo(
    () => (account.address ? getUAClient(account.address) : null),
    [account.address],
  );

  const pfp = user?.twitter?.profilePictureUrl ?? null;

  const value = useMemo<AccountContextValue>(
    () => ({
      ready: account.ready,
      authenticated: account.authenticated,
      profileReady: account.profileReady,
      profileError: account.profileError,
      profileId: account.profileId,
      handle: account.handle,
      email: account.email,
      identitySource: account.identitySource,
      needsOnboarding: account.needsOnboarding,
      onboardingCompletedAt: account.onboardingCompletedAt,
      pfp,
      address: account.address ?? null,
      balance: account.balance,
      deposits: account.deposits,
      upgraded: account.upgraded,
      isFunding: account.isFunding,
      fundingError: account.fundingError,
      ua,
      login: account.login,
      logout: account.logout,
      retryProfile: account.retryProfile,
      saveHandle: account.saveHandle,
      completeOnboarding: account.completeOnboarding,
      addMoney: account.addMoney,
      upgrade: account.upgrade,
      markUpgraded: account.markUpgraded,
      refreshBalance: account.refreshBalance,
    }),
    [
      account.ready,
      account.authenticated,
      account.profileReady,
      account.profileError,
      account.profileId,
      account.handle,
      account.email,
      account.identitySource,
      account.needsOnboarding,
      account.onboardingCompletedAt,
      pfp,
      account.address,
      account.balance,
      account.deposits,
      account.upgraded,
      account.isFunding,
      account.fundingError,
      ua,
      account.login,
      account.logout,
      account.retryProfile,
      account.saveHandle,
      account.completeOnboarding,
      account.addMoney,
      account.upgrade,
      account.markUpgraded,
      account.refreshBalance,
    ],
  );

  return (
    <AccountContextProvider value={value}>{children}</AccountContextProvider>
  );
}
