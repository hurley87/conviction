"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AccountContextProvider,
  type AccountContextValue,
} from "@/components/account/account-context";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { MockUAClient } from "@/lib/ua/mock";

const DEMO_HANDLE = "demo-trader";
const DEMO_PFP =
  "https://api.dicebear.com/7.x/avataaars/svg?seed=demo-trader";

export function MockAccountProvider({ children }: { children: React.ReactNode }) {
  const ua = useMemo(() => new MockUAClient(), []);
  const { balance, deposits, refresh } = useUASnapshot(ua);
  const [upgraded, setUpgraded] = useState(false);

  const noop = useCallback(() => {}, []);
  const asyncNoop = useCallback(async () => {}, []);
  const markUpgraded = useCallback(() => {
    setUpgraded(true);
  }, []);
  const upgrade = useCallback(async () => {
    await ua.ensureUpgraded();
    setUpgraded(true);
    await refresh();
  }, [ua, refresh]);

  const value = useMemo<AccountContextValue>(
    () => ({
      ready: true,
      authenticated: true,
      handle: DEMO_HANDLE,
      pfp: DEMO_PFP,
      address: deposits?.evm ?? null,
      balance,
      deposits,
      upgraded,
      isFunding: false,
      fundingError: null,
      ua,
      login: noop,
      logout: noop,
      addMoney: asyncNoop,
      upgrade,
      markUpgraded,
      refreshBalance: refresh,
    }),
    [
      deposits,
      balance,
      upgraded,
      ua,
      noop,
      asyncNoop,
      upgrade,
      markUpgraded,
      refresh,
    ],
  );

  return (
    <AccountContextProvider value={value}>{children}</AccountContextProvider>
  );
}
