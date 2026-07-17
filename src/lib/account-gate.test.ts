import { describe, expect, it } from "vitest";
import { resolveAccountGate } from "@/lib/account-gate";

const ready = {
  ready: true,
  authenticated: true,
  profileReady: true,
  profileError: null,
  needsOnboarding: false,
};

describe("resolveAccountGate", () => {
  it("forces live app chrome to onboarding for unfinished profiles", () => {
    expect(
      resolveAccountGate({ ...ready, needsOnboarding: true }, "app", true),
    ).toBe("redirectOnboarding");
    expect(
      resolveAccountGate({ ...ready, needsOnboarding: true }, "app", false),
    ).toBe("ready");
  });

  it("lets onboarding render once the profile is ready", () => {
    expect(
      resolveAccountGate({ ...ready, needsOnboarding: true }, "onboarding", true),
    ).toBe("ready");
  });

  it("keeps unresolved and failed profiles out of the product chrome", () => {
    expect(resolveAccountGate({ ...ready, ready: false }, "app", true)).toBe(
      "loading",
    );
    expect(
      resolveAccountGate({ ...ready, authenticated: false }, "app", true),
    ).toBe("signedOut");
    expect(
      resolveAccountGate(
        { ...ready, profileError: "down", profileReady: false },
        "app",
        true,
      ),
    ).toBe("profileError");
    expect(
      resolveAccountGate({ ...ready, profileReady: false }, "app", true),
    ).toBe("loading");
  });
});
