import { describe, expect, it } from "vitest";
import { shouldForceOnboarding } from "@/lib/onboarding-rollout";

const ready = {
  live: true,
  authReady: true,
  authenticated: true,
  profileReady: true,
};

describe("first-run onboarding rollout", () => {
  it("forces only new live profiles", () => {
    expect(shouldForceOnboarding({ ...ready, needsOnboarding: true })).toBe(true);
    expect(shouldForceOnboarding({ ...ready, needsOnboarding: false })).toBe(false);
  });

  it("does not force mock mode or unresolved auth/profile state", () => {
    expect(
      shouldForceOnboarding({ ...ready, live: false, needsOnboarding: true }),
    ).toBe(false);
    expect(
      shouldForceOnboarding({ ...ready, profileReady: false, needsOnboarding: true }),
    ).toBe(false);
  });
});
