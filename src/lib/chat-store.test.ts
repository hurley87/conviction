import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChatMessage,
  clearChat,
  getChatPage,
  IdempotencyConflictError,
  resetChatMemoryForTests,
  StaleConversationError,
} from "@/lib/chat-store";

describe("chat store", () => {
  beforeEach(() => resetChatMemoryForTests());

  it("isolates each verified owner", async () => {
    const first = await getChatPage("did:privy:first");
    const second = await getChatPage("did:privy:second");
    await appendChatMessage("did:privy:first", {
      conversationId: first.conversationId,
      id: randomUUID(),
      role: "user",
      text: "private message",
    });

    expect((await getChatPage("did:privy:first")).messages).toHaveLength(1);
    expect((await getChatPage("did:privy:second")).messages).toEqual([]);
    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it("returns ordered pages of 100 with an earlier cursor", async () => {
    const { conversationId } = await getChatPage("owner");
    for (let index = 1; index <= 205; index += 1) {
      await appendChatMessage("owner", {
        conversationId,
        id: randomUUID(),
        role: index % 2 ? "user" : "assistant",
        text: `message ${index}`,
      });
    }

    const latest = await getChatPage("owner");
    expect(latest.messages).toHaveLength(100);
    expect(latest.messages[0].text).toBe("message 106");
    expect(latest.messages[99].text).toBe("message 205");
    expect(latest.nextCursor).toBe(latest.messages[0].sequence);

    const earlier = await getChatPage("owner", BigInt(latest.nextCursor!));
    expect(earlier.messages).toHaveLength(100);
    expect(earlier.messages[0].text).toBe("message 6");
    expect(earlier.messages[99].text).toBe("message 105");

    const earliest = await getChatPage("owner", BigInt(earlier.nextCursor!));
    expect(earliest.messages.map((message) => message.text)).toEqual([
      "message 1",
      "message 2",
      "message 3",
      "message 4",
      "message 5",
    ]);
    expect(earliest.nextCursor).toBeNull();
  });

  it("makes identical appends idempotent and rejects key reuse", async () => {
    const { conversationId } = await getChatPage("owner");
    const input = {
      conversationId,
      id: randomUUID(),
      role: "user" as const,
      text: "only once",
    };
    const first = await appendChatMessage("owner", input);
    const retry = await appendChatMessage("owner", input);
    expect(retry).toEqual(first);
    expect((await getChatPage("owner")).messages).toHaveLength(1);
    await expect(
      appendChatMessage("owner", { ...input, text: "different" }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("permanently clears the transcript and rejects stale writes", async () => {
    const first = await getChatPage("owner");
    await appendChatMessage("owner", {
      conversationId: first.conversationId,
      id: randomUUID(),
      role: "assistant",
      text: "old transcript",
    });
    const rotatedId = await clearChat("owner");
    const after = await getChatPage("owner");
    expect(after.conversationId).toBe(rotatedId);
    expect(after.messages).toEqual([]);
    await expect(
      appendChatMessage("owner", {
        conversationId: first.conversationId,
        id: randomUUID(),
        role: "user",
        text: "late write",
      }),
    ).rejects.toBeInstanceOf(StaleConversationError);
  });
});
