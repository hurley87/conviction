"use client";

// Per-handle swipe / save persistence for deck + feed Saved chip (issue #24).

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  EMPTY_SWIPE_STATE,
  notifySwipeStateChanged,
  readSwipeState,
  recordSwipe,
  subscribeSwipeState,
  writeSwipeState,
  type SwipeState,
  type SwipeVerb,
} from "@/lib/verbs/swipe-state";

function getServerSnapshot(): SwipeState {
  return EMPTY_SWIPE_STATE;
}

export function useSwipeState(handle: string | null) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeSwipeState(onStoreChange),
    [],
  );

  const getSnapshot = useCallback((): SwipeState => {
    if (!handle || typeof window === "undefined") return EMPTY_SWIPE_STATE;
    return readSwipeState(handle, window.localStorage);
  }, [handle]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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

  return useMemo(() => ({ state, record }), [state, record]);
}
