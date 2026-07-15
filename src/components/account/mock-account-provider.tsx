"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccountContextProvider,
  type AccountContextValue,
} from "@/components/account/account-context";
import { useUASnapshot } from "@/hooks/use-ua-snapshot";
import { MockUAClient } from "@/lib/ua/mock";
import {
  UPGRADE_IN_PLACE_EVENT,
  markUpgradeBeatSeen,
  shouldRevealUpgradeBeat,
} from "@/lib/upgrade-beat";

const DEMO_HANDLE = "demo-trader";
const DEMO_PFP =
  "https://api.dicebear.com/7.x/avataaars/svg?seed=demo-trader";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function MockAccountProvider({ children }: { children: React.ReactNode }) {
  const ua = useMemo(() => new MockUAClient(), []);
  const { balance, deposits, refresh } = useUASnapshot(ua);
  const [upgraded, setUpgraded] = useState(false);
  const [showUpgradeBeat, setShowUpgradeBeat] = useState(false);

  const address = deposits?.evm ?? null;

  const tryRevealUpgradeBeat = useCallback((addr: string | null) => {
    const storage = browserStorage();
    if (!storage || !addr || !shouldRevealUpgradeBeat(addr, storage)) return;
    setShowUpgradeBeat(true);
  }, []);

  const dismissUpgradeBeat = useCallback(() => {
    const storage = browserStorage();
    if (address && storage) {
      markUpgradeBeatSeen(address, storage);
    }
    setShowUpgradeBeat(false);
  }, [address]);

  useEffect(() => {
    if (!address) return;
    tryRevealUpgradeBeat(address);
  }, [address, tryRevealUpgradeBeat]);

  useEffect(() => {
    if (!address) return;
    const onUpgraded = () => {
      setUpgraded(true);
      tryRevealUpgradeBeat(address);
    };
    window.addEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    return () => {
      window.removeEventListener(UPGRADE_IN_PLACE_EVENT, onUpgraded);
    };
  }, [address, tryRevealUpgradeBeat]);

  const noop = useCallback(() => {}, []);
  const asyncNoop = useCallback(async () => {}, []);
  const upgrade = useCallback(async () => {
    await ua.ensureUpgraded();
    setUpgraded(true);
    tryRevealUpgradeBeat(address);
    await refresh();
  }, [ua, refresh, tryRevealUpgradeBeat, address]);

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
