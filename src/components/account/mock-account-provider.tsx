"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccountContextProvider,
  type AccountContextValue,
} from "@/components/account/account-context";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { useUpgradeBeat } from "@/hooks/use-upgrade-beat";
import { MockUAClient } from "@/lib/ua/mock";
import { UPGRADE_IN_PLACE_EVENT } from "@/lib/upgrade-beat";

const DEMO_HANDLE = "demo-trader";
const DEMO_PFP =
  "https://api.dicebear.com/7.x/avataaars/svg?seed=demo-trader";

export function MockAccountProvider({ children }: { children: React.ReactNode }) {
  const ua = useMemo(() => new MockUAClient(), []);
  const { balance, deposits, refresh } = useUASnapshot(ua);
  const [upgraded, setUpgraded] = useState(false);

  const address = deposits?.evm ?? null;
  const { showUpgradeBeat, dismissUpgradeBeat } = useUpgradeBeat(address, true);

  useEffect(() => {
    if (!address) return;
    const onUpgraded = () => {
      setUpgraded(true);
    };
    window.addEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    return () => {
      window.removeEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    };
  }, [address]);

  const noop = useCallback(() => {}, []);
  const asyncNoop = useCallback(async () => {}, []);
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
      address,
      balance,
      deposits,
      upgraded,
      isFunding: false,
      fundingError: null,
      showUpgradeBeat,
      ua,
      login: noop,
      logout: noop,
      addMoney: asyncNoop,
      upgrade,
      dismissUpgradeBeat,
    }),
    [
      address,
      deposits,
      balance,
      upgraded,
      showUpgradeBeat,
      ua,
      noop,
      asyncNoop,
      upgrade,
      dismissUpgradeBeat,
    ],
  );

  return (
    <AccountContextProvider value={value}>{children}</AccountContextProvider>
  );
}
