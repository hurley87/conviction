import { describe, expect, it, vi } from "vitest";
import {
  clearCurrentLesson,
  createOnboardingState,
  onboardingProgress,
  onboardingReducer,
  onboardingStorageKey,
  performSandboxAction,
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

  it("sandbox actions cannot call fetch or live mutation callbacks", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const liveMutation = vi.fn();
    const dispatch = vi.fn();

    performSandboxAction(dispatch, { type: "deck", gesture: "back" });
    performSandboxAction(dispatch, { type: "trade-phase", phase: "receipt" });
    performSandboxAction(dispatch, { type: "conviction-preview" });

    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(liveMutation).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
