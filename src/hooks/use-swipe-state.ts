"use client";

// Per-handle swipe / save persistence for deck + feed Saved chip (issue #24).

import { useCallback, useSyncExternalStore } from "react";
import {
  EMPTY_SWIPE_STATE,
  notifySwipeStateChanged,
  readSwipeState,
  recordSwipe,
  subscribeSwipeState,
  writeSwipeState,
  type SwipeVerb,
} from "@/lib/verbs/swipe-state";

export function useSwipeState(handle: string | null) {
  const state = useSyncExternalStore(
    subscribeSwipeState,
    () => {
      if (!handle || typeof window === "undefined") return EMPTY_SWIPE_STATE;
      return readSwipeState(handle, window.localStorage);
    },
    () => EMPTY_SWIPE_STATE,
  );

  const record = useCallback(
    (entryId: string, verb: SwipeVerb) => {
      if (!handle || typeof window === "undefined") return;
      const next = recordSwipe(
        readSwipeState(handle, window.localStorage),
        entryId,
        verb,
      );
      writeSwipeState(handle, next, window.localStorage);
      notifySwipeStateChanged();
    },
    [handle],
  );

  return { state, record };
}
