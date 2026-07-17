import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateRequest } from "@/lib/server-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authenticateRequest", () => {
  it("requires a bearer credential", async () => {
    await expect(
      authenticateRequest(new Request("http://localhost/api/agents")),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it("allows the deterministic local mock only outside production", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    vi.stubEnv("NODE_ENV", "test");
    await expect(
      authenticateRequest(
        new Request("http://localhost/api/agents", {
          headers: { authorization: "Bearer mock-local-user" },
        }),
      ),
    ).resolves.toEqual({ userId: "mock-local-user", mock: true });

    vi.stubEnv("NODE_ENV", "production");
    await expect(
      authenticateRequest(
        new Request("http://localhost/api/agents", {
          headers: { authorization: "Bearer mock-local-user" },
        }),
      ),
    ).rejects.toMatchObject({
      status: 503,
    });
  });
});
