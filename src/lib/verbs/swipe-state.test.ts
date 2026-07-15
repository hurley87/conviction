import { describe, it, expect, beforeEach } from "vitest";
import {
  EMPTY_SWIPE_STATE,
  filterSavedConvictions,
  isSaved,
  parseSwipeState,
  readSwipeState,
  recordSwipe,
  remainingDeckCards,
  resolveSwipeVerb,
  SWIPE_COMMIT_PX,
  SWIPE_HINT_PX,
  swipeStateStorageKey,
  writeSwipeState,
} from "@/lib/verbs/swipe-state";
import { DECK_SEED_CARDS } from "@/lib/deck-seed";
import type { ConvictionEntry } from "@/lib/verbs/types";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    key() {
      return null;
    },
  };
}

const a = DECK_SEED_CARDS[0]!;
const b = DECK_SEED_CARDS[1]!;

describe("swipeStateStorageKey", () => {
  it("keys by lowercased handle", () => {
    expect(swipeStateStorageKey("Demo-Trader")).toBe(
      "conviction:swipe-state:demo-trader",
    );
  });
});

describe("recordSwipe / remainingDeckCards", () => {
  it("removes acted-on cards from the deck in order", () => {
    let state = EMPTY_SWIPE_STATE;
    expect(remainingDeckCards([a, b], state).map((c) => c.entryId)).toEqual([
      a.entryId,
      b.entryId,
    ]);

    state = recordSwipe(state, a.entryId, "skip");
    expect(remainingDeckCards([a, b], state).map((c) => c.entryId)).toEqual([
      b.entryId,
    ]);

    state = recordSwipe(state, b.entryId, "save");
    expect(remainingDeckCards([a, b], state)).toEqual([]);
  });

  it("does not resurface skipped cards after a fresh read", () => {
    const storage = memoryStorage();
    const written = recordSwipe(EMPTY_SWIPE_STATE, a.entryId, "skip");
    writeSwipeState("demo-trader", written, storage);

    const reloaded = readSwipeState("demo-trader", storage);
    expect(remainingDeckCards([a, b], reloaded).map((c) => c.entryId)).toEqual([
      b.entryId,
    ]);
  });
});

describe("saved filter", () => {
  it("marks and filters saved cards only", () => {
    const state = recordSwipe(
      recordSwipe(EMPTY_SWIPE_STATE, a.entryId, "save"),
      b.entryId,
      "skip",
    );
    expect(isSaved(state, a.entryId)).toBe(true);
    expect(isSaved(state, b.entryId)).toBe(false);

    const feed: ConvictionEntry[] = [a, b];
    expect(filterSavedConvictions(feed, state).map((c) => c.entryId)).toEqual([
      a.entryId,
    ]);
  });
});

describe("resolveSwipeVerb", () => {
  it("maps axes at commit threshold", () => {
    expect(resolveSwipeVerb(-SWIPE_COMMIT_PX, 0, SWIPE_COMMIT_PX)).toBe("skip");
    expect(resolveSwipeVerb(SWIPE_COMMIT_PX, 0, SWIPE_COMMIT_PX)).toBe("back");
    expect(resolveSwipeVerb(0, -SWIPE_COMMIT_PX, SWIPE_COMMIT_PX)).toBe("save");
  });

  it("lets vertical dominate diagonals", () => {
    expect(
      resolveSwipeVerb(-50, -SWIPE_COMMIT_PX, SWIPE_COMMIT_PX),
    ).toBe("save");
    expect(
      resolveSwipeVerb(-SWIPE_COMMIT_PX, -50, SWIPE_COMMIT_PX),
    ).toBe("skip");
  });

  it("returns null under threshold", () => {
    expect(resolveSwipeVerb(-SWIPE_HINT_PX, 0, SWIPE_COMMIT_PX)).toBeNull();
    expect(resolveSwipeVerb(0, -SWIPE_HINT_PX, SWIPE_COMMIT_PX)).toBeNull();
  });

  it("uses the same policy for hint threshold", () => {
    expect(resolveSwipeVerb(-SWIPE_HINT_PX, 0, SWIPE_HINT_PX)).toBe("skip");
    expect(resolveSwipeVerb(0, -SWIPE_HINT_PX, SWIPE_HINT_PX)).toBe("save");
  });
});

describe("parseSwipeState", () => {
  it("tolerates corrupt storage", () => {
    expect(parseSwipeState("not-json")).toEqual({ byId: {} });
    expect(parseSwipeState('{"byId":{"x":"nope"}}')).toEqual({ byId: {} });
    expect(parseSwipeState('{"byId":{"x":"back"}}')).toEqual({
      byId: { x: "back" },
    });
  });
});

describe("persistence round-trip", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("survives reload for the same handle", () => {
    const state = recordSwipe(
      recordSwipe(EMPTY_SWIPE_STATE, a.entryId, "back"),
      b.entryId,
      "save",
    );
    writeSwipeState("alice", state, storage);
    expect(readSwipeState("Alice", storage)).toEqual(state);
    expect(readSwipeState("bob", storage)).toEqual(EMPTY_SWIPE_STATE);
  });
});
