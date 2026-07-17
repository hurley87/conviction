import { describe, expect, it, vi } from "vitest";
import { requirePrivyUserId } from "@/lib/chat-auth";

const claims = {
  app_id: "app",
  issuer: "privy.io",
  issued_at: 1,
  expiration: 2,
  session_id: "session",
  user_id: "did:privy:user-1",
};

describe("chat bearer authentication", () => {
  it("rejects a missing bearer token", async () => {
    await expect(
      requirePrivyUserId(new Request("https://example.test/api/chat"), vi.fn()),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("uses the verified Privy user id as the owner", async () => {
    const verify = vi.fn().mockResolvedValue(claims);
    const ownerId = await requirePrivyUserId(
      new Request("https://example.test/api/chat", {
        headers: { authorization: "Bearer valid-token" },
      }),
      verify,
    );
    expect(ownerId).toBe("did:privy:user-1");
    expect(verify).toHaveBeenCalledWith("valid-token");
  });

  it("rejects tokens that fail verification", async () => {
    const request = new Request("https://example.test/api/chat", {
      headers: { authorization: "Bearer invalid-token" },
    });
    await expect(
      requirePrivyUserId(request, vi.fn().mockRejectedValue(new Error("bad"))),
    ).rejects.toMatchObject({ status: 401 });
  });
});
