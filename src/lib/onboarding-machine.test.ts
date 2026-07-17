import { describe, expect, it } from "vitest";
import {
  canAdvance,
  clearCurrentLesson,
  createOnboardingState,
  onboardingProgress,
  onboardingReducer,
  onboardingStorageKey,
  readCurrentLesson,
  writeCurrentLesson,
} from "@/lib/onboarding-machine";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

describe("onboarding reducer and persistence", () => {
  it("keeps progress in range and records local practice milestones", () => {
    let state = createOnboardingState();
    state = onboardingReducer(state, { type: "back" });
    expect(state.step).toBe(0);
    state = onboardingReducer(state, { type: "deck", gesture: "save" });
    state = onboardingReducer(state, { type: "trade-size", size: 500 });
    expect(state.deckGestures.save).toBe(true);
    expect(state.tradeSize).toBe(100);
    expect(onboardingProgress(0)).toBe(14);
    expect(onboardingProgress(6)).toBe(100);
  });

  it("stores only the versioned current lesson and clears it at completion", () => {
    const storage = memoryStorage();
    writeCurrentLesson(storage, "did:privy:1", 4);
    expect([...storage.values.entries()]).toEqual([
      [onboardingStorageKey("did:privy:1"), "4"],
    ]);
    expect(readCurrentLesson(storage, "did:privy:1")).toBe(4);
    clearCurrentLesson(storage, "did:privy:1");
    expect(readCurrentLesson(storage, "did:privy:1")).toBe(0);
  });

  it("gates continue on practice milestones and email username validity", () => {
    const state = createOnboardingState();
    expect(
      canAdvance("identity", state, {
        source: "email",
        usernameDraftValid: false,
      }),
    ).toBe(false);
    expect(
      canAdvance("identity", state, {
        source: "twitter",
        usernameDraftValid: false,
      }),
    ).toBe(true);
    expect(
      canAdvance("deck", state, { source: "email", usernameDraftValid: true }),
    ).toBe(false);
    const deckDone = onboardingReducer(
      onboardingReducer(
        onboardingReducer(state, { type: "deck", gesture: "skip" }),
        { type: "deck", gesture: "save" },
      ),
      { type: "deck", gesture: "back" },
    );
    expect(
      canAdvance("deck", deckDone, {
        source: "email",
        usernameDraftValid: true,
      }),
    ).toBe(true);
  });
});
