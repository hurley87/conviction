// Per-user deck swipe records — skip / save / back (ADR 0016, issue #24).
// App-level only: the deck consumes; the feed archives. Persistence is keyed
// by handle so a reload / re-login does not resurface acted-on cards.

import {
  notifyLocalStorageEvent,
  subscribeLocalStorageEvent,
  type StorageLike,
} from "@/lib/local-storage-store";
import type { ConvictionEntry } from "@/lib/verbs/types";

export type SwipeVerb = "skip" | "save" | "back";

export type SwipeState = {
  /** Last verb per conviction — one action removes the card from the deck. */
  byId: Record<string, SwipeVerb>;
};

export const SWIPE_STATE_STORAGE_PREFIX = "conviction:swipe-state:";
export const SWIPE_STATE_STORAGE_EVENT = "conviction:swipe-state-storage";

/** Pointer travel (px) required to commit a swipe verb. */
export const SWIPE_COMMIT_PX = 110;
/** Pointer travel (px) to show the in-flight verb hint. */
export const SWIPE_HINT_PX = 40;

export const EMPTY_SWIPE_STATE: SwipeState = { byId: {} };

/** Referential cache so useSyncExternalStore snapshots stay stable. */
let snapshotCache: {
  key: string;
  raw: string | null;
  state: SwipeState;
} | null = null;

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
  const key = swipeStateStorageKey(handle);
  const raw = storage.getItem(key);
  if (
    snapshotCache &&
    snapshotCache.key === key &&
    snapshotCache.raw === raw
  ) {
    return snapshotCache.state;
  }
  const state = parseSwipeState(raw);
  snapshotCache = { key, raw, state };
  return state;
}

export function writeSwipeState(
  handle: string,
  state: SwipeState,
  storage: StorageLike,
): void {
  const key = swipeStateStorageKey(handle);
  const raw = JSON.stringify(state);
  storage.setItem(key, raw);
  snapshotCache = { key, raw, state };
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

/** Feed archive filter: keep only cards the user saved. */
export function filterSavedConvictions(
  convictions: ConvictionEntry[],
  state: SwipeState,
): ConvictionEntry[] {
  return convictions.filter((c) => isSaved(state, c.entryId));
}

/**
 * Map pointer delta to a swipe verb. Vertical (up) wins when it dominates;
 * otherwise horizontal left = skip, right = back.
 */
export function resolveSwipeVerb(
  dx: number,
  dy: number,
  thresholdPx: number,
): SwipeVerb | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (dy <= -thresholdPx && absY >= absX) return "save";
  if (dx <= -thresholdPx && absX > absY) return "skip";
  if (dx >= thresholdPx && absX > absY) return "back";
  return null;
}

export function notifySwipeStateChanged(): void {
  notifyLocalStorageEvent(SWIPE_STATE_STORAGE_EVENT);
}

export function subscribeSwipeState(onStoreChange: () => void): () => void {
  return subscribeLocalStorageEvent(SWIPE_STATE_STORAGE_EVENT, onStoreChange);
}
