"use client";

import { createContext, useContext } from "react";
import { IS_LIVE } from "@/lib/env";
import type { UAClient } from "@/lib/ua";
import type { DepositAddresses, UniversalBalance } from "@/lib/verbs/types";
import { LiveAccountProvider } from "@/components/account/live-account-provider";
import { MockAccountProvider } from "@/components/account/mock-account-provider";

export type AccountContextValue = {
  ready: boolean;
  authenticated: boolean;
  handle: string | null;
  pfp: string | null;
  address: string | null;
  balance: UniversalBalance | null;
  deposits: DepositAddresses | null;
  upgraded: boolean;
  isFunding: boolean;
  fundingError: string | null;
  /** Once-only upgrade-in-place beat (issue #19). */
  showUpgradeBeat: boolean;
  ua: UAClient | null;
  login: () => void;
  logout: () => void;
  addMoney: () => Promise<void>;
  upgrade: () => Promise<void>;
  dismissUpgradeBeat: () => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  return IS_LIVE ? (
    <LiveAccountProvider>{children}</LiveAccountProvider>
  ) : (
    <MockAccountProvider>{children}</MockAccountProvider>
  );
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) {
    throw new Error("useAccount must be used within AccountProvider");
  }
  return ctx;
}

export function AccountContextProvider({
  value,
  children,
}: {
  value: AccountContextValue;
  children: React.ReactNode;
}) {
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}
