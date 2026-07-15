// Shared localStorage external-store plumbing for per-key client persistence
// (upgrade-beat, swipe-state, etc.). Policy stays in domain modules.

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Same-tab notify for useSyncExternalStore after a local write. */
export function notifyLocalStorageEvent(eventName: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(eventName));
}

/**
 * Subscribe to cross-tab `storage` plus a same-tab custom event for one domain.
 */
export function subscribeLocalStorageEvent(
  eventName: string,
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(eventName, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(eventName, onStoreChange);
  };
}
