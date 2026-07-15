// Per-user deck swipe records — skip / save / back (ADR 0016, issue #24).
// App-level only: the deck consumes; the feed archives. Persistence is keyed
// by handle so a reload / re-login does not resurface acted-on cards.

import type { ConvictionEntry } from "@/lib/verbs/types";

export type SwipeVerb = "skip" | "save" | "back";

export type SwipeState = {
  /** Last verb per conviction — one action removes the card from the deck. */
  byId: Record<string, SwipeVerb>;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const SWIPE_STATE_STORAGE_PREFIX = "conviction:swipe-state:";
export const SWIPE_STATE_STORAGE_EVENT = "conviction:swipe-state-storage";

export const EMPTY_SWIPE_STATE: SwipeState = { byId: {} };

export function swipeStateStorageKey(handle: string): string {
  return `${SWIPE_STATE_STORAGE_PREFIX}${handle.trim().toLowerCase()}`;
}

export function parseSwipeState(raw: string | null): SwipeState {
  if (!raw) return { byId: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("byId" in parsed) ||
      typeof (parsed as { byId: unknown }).byId !== "object" ||
      (parsed as { byId: unknown }).byId === null
    ) {
      return { byId: {} };
    }
    const byId: Record<string, SwipeVerb> = {};
    for (const [id, verb] of Object.entries(
      (parsed as { byId: Record<string, unknown> }).byId,
    )) {
      if (verb === "skip" || verb === "save" || verb === "back") {
        byId[id] = verb;
      }
    }
    return { byId };
  } catch {
    return { byId: {} };
  }
}

export function readSwipeState(
  handle: string,
  storage: StorageLike,
): SwipeState {
  return parseSwipeState(storage.getItem(swipeStateStorageKey(handle)));
}

export function writeSwipeState(
  handle: string,
  state: SwipeState,
  storage: StorageLike,
): void {
  storage.setItem(swipeStateStorageKey(handle), JSON.stringify(state));
}

/** Record a verb for an entry (idempotent overwrite). */
export function recordSwipe(
  state: SwipeState,
  entryId: string,
  verb: SwipeVerb,
): SwipeState {
  if (state.byId[entryId] === verb) return state;
  return { byId: { ...state.byId, [entryId]: verb } };
}

/** Cards still in the deck — anything already acted on is gone. */
export function remainingDeckCards(
  cards: ConvictionEntry[],
  state: SwipeState,
): ConvictionEntry[] {
  return cards.filter((c) => state.byId[c.entryId] == null);
}

export function isSaved(state: SwipeState, entryId: string): boolean {
  return state.byId[entryId] === "save";
}

export function savedEntryIds(state: SwipeState): string[] {
  return Object.entries(state.byId)
    .filter(([, verb]) => verb === "save")
    .map(([id]) => id);
}

/** Feed archive filter: keep only cards the user saved. */
export function filterSavedConvictions(
  convictions: ConvictionEntry[],
  state: SwipeState,
): ConvictionEntry[] {
  return convictions.filter((c) => isSaved(state, c.entryId));
}

export function notifySwipeStateChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SWIPE_STATE_STORAGE_EVENT));
}

export function subscribeSwipeState(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SWIPE_STATE_STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SWIPE_STATE_STORAGE_EVENT, onStoreChange);
  };
}
