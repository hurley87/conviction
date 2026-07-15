// Once-only upgrade-in-place beat (issue #19). Persists per address so the
// moment appears at most once — at login or after the first 7702 authorization —
// and never blocks the flow.

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const UPGRADE_BEAT_STORAGE_PREFIX = "conviction:upgrade-beat-seen:";

/** Fired when a real in-place upgrade auth was signed (first trade). */
export const UPGRADE_IN_PLACE_EVENT = "conviction:upgraded-in-place";

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

export function emitUpgradedInPlace(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(UPGRADE_IN_PLACE_EVENT));
}
