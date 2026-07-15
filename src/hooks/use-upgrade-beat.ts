"use client";

// Once-only upgrade-in-place beat visibility (issue #19). Derived from
// localStorage + dismiss state — no setState-in-effect for the reveal path.

import { useCallback, useEffect, useState } from "react";
import {
  markUpgradeBeatSeen,
  shouldRevealUpgradeBeat,
  type StorageLike,
} from "@/lib/upgrade-beat";

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useUpgradeBeat(
  address: string | null | undefined,
  enabled: boolean,
) {
  // Defer storage reads until after mount to avoid SSR/hydration mismatch.
  const [clientReady, setClientReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [beatAddress, setBeatAddress] = useState(address);

  // Sync dismiss reset when the address identity changes (React-allowed
  // adjust-state-during-render pattern).
  if (address !== beatAddress) {
    setBeatAddress(address);
    setDismissed(false);
  }

  useEffect(() => {
    queueMicrotask(() => setClientReady(true));
  }, []);

  const storage = clientReady ? browserStorage() : null;
  const showUpgradeBeat =
    enabled &&
    Boolean(address) &&
    storage != null &&
    !dismissed &&
    shouldRevealUpgradeBeat(address, storage);

  const dismissUpgradeBeat = useCallback(() => {
    const store = browserStorage();
    if (address && store) {
      markUpgradeBeatSeen(address, store);
    }
    setDismissed(true);
  }, [address]);

  return { showUpgradeBeat, dismissUpgradeBeat };
}
