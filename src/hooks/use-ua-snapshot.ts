"use client";

// Loads the Universal Account snapshot (unified balance + deposit addresses)
// for a UA client and reloads it whenever the client changes. Shared by the
// live and mock account panels so the balance/deposits fetch lives in one place.

import { useCallback, useEffect, useState } from "react";
import type { UAClient } from "@/lib/ua/types";
import type { DepositAddresses, UniversalBalance } from "@/lib/verbs/types";

export function useUASnapshot(ua: UAClient | null) {
  const [balance, setBalance] = useState<UniversalBalance | null>(null);
  const [deposits, setDeposits] = useState<DepositAddresses | null>(null);

  useEffect(() => {
    if (!ua) return;
    let active = true;
    void Promise.all([ua.getUniversalBalance(), ua.getDepositAddresses()])
      .then(([nextBalance, nextDeposits]) => {
        if (!active) return;
        setBalance(nextBalance);
        setDeposits(nextDeposits);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ua]);

  // Re-fetch only the balance — deposit addresses are static per account.
  const refresh = useCallback(async () => {
    if (!ua) return;
    setBalance(await ua.getUniversalBalance());
  }, [ua]);

  return { balance, deposits, refresh };
}
