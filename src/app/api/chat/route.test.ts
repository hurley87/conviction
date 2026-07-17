import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat-auth", () => {
  class ChatAuthError extends Error {
    constructor(
      message: string,
      readonly status: 401 | 503,
    ) {
      super(message);
    }
  }
  return {
    ChatAuthError,
    requirePrivyUserId: (request: Request) =>
      Promise.resolve(request.headers.get("x-test-owner") ?? "owner"),
  };
});

import { DELETE, GET, POST } from "@/app/api/chat/route";
import { resetChatMemoryForTests } from "@/lib/chat-store";

function request(method: string, body?: unknown, owner = "owner", query = "") {
  return new Request(`https://example.test/api/chat${query}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-test-owner": owner,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("chat route input and lifecycle", () => {
  beforeEach(() => resetChatMemoryForTests());

  it("rejects invalid cursors and message bodies", async () => {
    expect((await GET(request("GET", undefined, "owner", "?before=nope"))).status).toBe(400);
    expect((await POST(request("POST", { role: "user", text: "missing ids" }))).status).toBe(400);
    expect(
      (
        await POST(
          request("POST", {
            conversationId: randomUUID(),
            id: randomUUID(),
            role: "system",
            text: "not allowed",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("appends, reads, and clears through the HTTP contract", async () => {
    const initial = await (await GET(request("GET"))).json();
    const id = randomUUID();
    const append = await POST(
      request("POST", {
        conversationId: initial.conversationId,
        id,
        role: "user",
        text: "hello",
      }),
    );
    expect(append.status).toBe(200);
    expect((await append.json()).message.id).toBe(id);
    const page = await (await GET(request("GET"))).json();
    expect(page.messages.map((message: { text: string }) => message.text)).toEqual([
      "hello",
    ]);

    const cleared = await DELETE(request("DELETE"));
    expect(cleared.status).toBe(200);
    const next = await (await GET(request("GET"))).json();
    expect(next.messages).toEqual([]);
    expect(next.conversationId).not.toBe(initial.conversationId);
  });
});
