// Once-only upgrade-in-place beat persistence (issue #19). Seen-state is keyed
// per address so the moment appears at most once and never blocks the flow.

import {
  notifyLocalStorageEvent,
  subscribeLocalStorageEvent,
  type StorageLike,
} from "@/lib/local-storage-store";

export type { StorageLike };

export const UPGRADE_BEAT_STORAGE_PREFIX = "conviction:upgrade-beat-seen:";

/** Same-tab notify for useSyncExternalStore subscribers after local writes. */
export const UPGRADE_BEAT_STORAGE_EVENT = "conviction:upgrade-beat-storage";

export function upgradeBeatStorageKey(address: string): string {
  return `${UPGRADE_BEAT_STORAGE_PREFIX}${address.toLowerCase()}`;
}

export function hasSeenUpgradeBeat(
  address: string,
  storage: StorageLike,
): boolean {
  return storage.getItem(upgradeBeatStorageKey(address)) === "1";
}

export function markUpgradeBeatSeen(
  address: string,
  storage: StorageLike,
): void {
  storage.setItem(upgradeBeatStorageKey(address), "1");
}

/** Whether the beat should open for this address (not yet seen). */
export function shouldRevealUpgradeBeat(
  address: string | null | undefined,
  storage: StorageLike,
): boolean {
  if (!address) return false;
  return !hasSeenUpgradeBeat(address, storage);
}

export function notifyUpgradeBeatStorageChanged(): void {
  notifyLocalStorageEvent(UPGRADE_BEAT_STORAGE_EVENT);
}

export function subscribeUpgradeBeatStorage(
  onStoreChange: () => void,
): () => void {
  return subscribeLocalStorageEvent(UPGRADE_BEAT_STORAGE_EVENT, onStoreChange);
}
