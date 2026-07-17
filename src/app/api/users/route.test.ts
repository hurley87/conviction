import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  initialize: vi.fn(),
  saveHandle: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@/lib/privy-profile-auth", () => {
  class PrivyProfileAuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 503,
    ) {
      super(message);
    }
  }
  return {
    PrivyProfileAuthError,
    getAuthenticatedPrivyIdentity: mocks.identity,
  };
});

vi.mock("@/lib/users", () => {
  class UserProfileError extends Error {
    constructor(
      message: string,
      readonly code: "unavailable" | "conflict" | "validation" | "not-found",
    ) {
      super(message);
    }
  }
  return {
    UserProfileError,
    initializeUser: mocks.initialize,
    saveUserHandle: mocks.saveHandle,
    completeUserOnboarding: mocks.complete,
  };
});

import { PATCH, POST } from "@/app/api/users/route";
import { PrivyProfileAuthError } from "@/lib/privy-profile-auth";
import { UserProfileError } from "@/lib/users";

const verifiedIdentity = {
  privyId: "did:privy:verified",
  email: "person@example.com",
  identitySource: "email" as const,
  providerHandle: null,
};
const profile = {
  ...verifiedIdentity,
  handle: null,
  address: "0xabc",
  onboardingRequired: true,
  onboardingCompletedAt: null,
  created: true,
};

function request(method: "POST" | "PATCH", body: unknown) {
  return new Request("https://example.test/api/users", {
    method,
    headers: {
      authorization: "Bearer verified-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("authenticated profile API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue(verifiedIdentity);
    mocks.initialize.mockResolvedValue(profile);
    mocks.saveHandle.mockResolvedValue({ ...profile, handle: "public_name" });
  });

  it("derives identity server-side and ignores client identity claims", async () => {
    const response = await POST(
      request("POST", {
        address: "0xabc",
        privyId: "attacker",
        handle: "spoofed",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledWith({
      ...verifiedIdentity,
      address: "0xabc",
    });
  });

  it("maps authentication, uniqueness, validation, and availability errors", async () => {
    mocks.identity.mockRejectedValueOnce(
      new PrivyProfileAuthError("invalid token", 401),
    );
    expect((await POST(request("POST", { address: "0xabc" }))).status).toBe(401);

    mocks.saveHandle.mockRejectedValueOnce(
      new UserProfileError("already used", "conflict"),
    );
    expect((await PATCH(request("PATCH", { handle: "Taken" }))).status).toBe(409);

    expect((await PATCH(request("PATCH", { nope: true }))).status).toBe(422);

    mocks.initialize.mockRejectedValueOnce(
      new UserProfileError("no database", "unavailable"),
    );
    expect((await POST(request("POST", { address: "0xabc" }))).status).toBe(503);
  });

  it("normalizes uniqueness through the save contract", async () => {
    await PATCH(request("PATCH", { handle: "@Trader" }));
    expect(mocks.saveHandle).toHaveBeenCalledWith(
      "did:privy:verified",
      "@Trader",
    );
  });
});
