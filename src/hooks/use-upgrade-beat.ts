"use client";

// Once-only upgrade-in-place beat visibility (issue #19). Derived from
// localStorage via useSyncExternalStore; gated by the caller on real upgrade.

import { useCallback, useSyncExternalStore } from "react";
import {
  markUpgradeBeatSeen,
  notifyUpgradeBeatStorageChanged,
  shouldRevealUpgradeBeat,
  subscribeUpgradeBeatStorage,
} from "@/lib/upgrade-beat";

function readShouldReveal(address: string | null | undefined): boolean {
  if (typeof window === "undefined" || !address) return false;
  try {
    return shouldRevealUpgradeBeat(address, window.localStorage);
  } catch {
    return false;
  }
}

/**
 * @param address - account address (beat is once-per-address)
 * @param enabled - typically `authenticated && upgraded` so copy matches Settings
 */
export function useUpgradeBeat(
  address: string | null | undefined,
  enabled: boolean,
) {
  const unseen = useSyncExternalStore(
    subscribeUpgradeBeatStorage,
    () => readShouldReveal(address),
    () => false,
  );

  const showUpgradeBeat = enabled && Boolean(address) && unseen;

  const dismissUpgradeBeat = useCallback(() => {
    if (!address || typeof window === "undefined") return;
    try {
      markUpgradeBeatSeen(address, window.localStorage);
      notifyUpgradeBeatStorageChanged();
    } catch {
      // Storage unavailable — beat may reappear; never block the flow.
    }
  }, [address]);

  return { showUpgradeBeat, dismissUpgradeBeat };
}
