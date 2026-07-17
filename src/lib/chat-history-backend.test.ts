import { describe, expect, it, vi } from "vitest";
import {
  createApiChatHistory,
  createLocalChatHistory,
  pageLocalTranscript,
  readLocalTranscript,
} from "@/lib/chat-history-backend";
import type { ChatMessage } from "@/lib/chat-types";

const key = "conviction.chat.v1";

function storedMessage(index: number): ChatMessage {
  return {
    id: `message-${index}`,
    role: index % 2 ? "user" : "assistant",
    text: `message ${index}`,
    createdAt: new Date(index * 1_000).toISOString(),
    sequence: String(index),
  };
}

describe("chat history backends", () => {
  it("ignores an incompatible local storage version", () => {
    const transcript = readLocalTranscript({
      getItem: () => JSON.stringify({ version: 0, messages: ["legacy"] }),
    });
    expect(transcript.version).toBe(1);
    expect(transcript.messages).toEqual([]);
  });

  it("hydrates and paginates local demo history", () => {
    const messages = Array.from({ length: 105 }, (_, index) =>
      storedMessage(index + 1),
    );
    const storage = {
      getItem: (requested: string) =>
        requested === key
          ? JSON.stringify({
              version: 1,
              conversationId: "local-conversation",
              messages,
              nextSequence: 106,
            })
          : null,
      setItem: () => {},
    };
    const transcript = readLocalTranscript(storage);
    const latest = pageLocalTranscript(transcript);
    expect(latest.messages).toHaveLength(100);
    expect(latest.messages[0]?.text).toBe("message 6");
    const earlier = pageLocalTranscript(transcript, latest.nextCursor);
    expect(earlier.messages.map((message) => message.text)).toEqual([
      "message 1",
      "message 2",
      "message 3",
      "message 4",
      "message 5",
    ]);
  });

  it("appends and clears through the local backend", async () => {
    const data = new Map<string, string>();
    const backend = createLocalChatHistory({
      getItem: (name) => data.get(name) ?? null,
      setItem: (name, value) => {
        data.set(name, value);
      },
    });
    const page = await backend.loadPage();
    await backend.append(page.conversationId, {
      id: "11111111-1111-4111-8111-111111111111",
      role: "user",
      text: "hello",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    const afterAppend = await backend.loadPage();
    expect(afterAppend.messages).toHaveLength(1);
    const cleared = await backend.clear();
    expect(cleared.conversationId).not.toBe(page.conversationId);
    const afterClear = await backend.loadPage();
    expect(afterClear.messages).toEqual([]);
  });

  it("routes api backend calls through authenticated fetch", async () => {
    const fetchAuth = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/chat" && init?.method === "POST") {
        return new Response(null, { status: 200 });
      }
      if (input === "/api/chat" && init?.method === "DELETE") {
        return Response.json({
          conversationId: "22222222-2222-4222-8222-222222222222",
        });
      }
      return Response.json({
        conversationId: "11111111-1111-4111-8111-111111111111",
        messages: [],
        nextCursor: null,
      });
    });
    const backend = createApiChatHistory(fetchAuth);
    await backend.loadPage();
    await backend.append("11111111-1111-4111-8111-111111111111", {
      id: "33333333-3333-4333-8333-333333333333",
      role: "assistant",
      text: "hi",
      createdAt: "2026-07-16T00:00:00.000Z",
    });
    await backend.clear();
    expect(fetchAuth).toHaveBeenCalledTimes(3);
  });
});
