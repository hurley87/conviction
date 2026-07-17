import { describe, expect, it } from "vitest";
import {
  CHAT_WELCOME_MESSAGE,
  INTERRUPTED_QUOTE_NOTICE,
  mergeChatMessages,
  QUOTE_READY_MESSAGE,
  restoreChatMessages,
  type ChatMessage,
} from "@/lib/chat-types";

function message(id: string, text: string): ChatMessage {
  return {
    id,
    role: "assistant",
    text,
    createdAt: "2026-07-16T00:00:00.000Z",
  };
}

describe("chat hydration", () => {
  it("restores history behind the local welcome message", () => {
    const restored = restoreChatMessages([message("one", "Hello")]);
    expect(restored.messages.map((item) => item.id)).toEqual([
      CHAT_WELCOME_MESSAGE.id,
      "one",
    ]);
    expect(restored.interruption).toBeNull();
  });

  it("adds one interruption notice for a restored quote prompt", () => {
    const first = restoreChatMessages([
      message("quote", QUOTE_READY_MESSAGE),
    ]);
    expect(first.interruption?.text).toBe(INTERRUPTED_QUOTE_NOTICE);
    const second = restoreChatMessages(
      first.messages.filter((item) => item.id !== CHAT_WELCOME_MESSAGE.id),
    );
    expect(second.interruption).toBeNull();
    expect(
      second.messages.filter((item) => item.text === INTERRUPTED_QUOTE_NOTICE),
    ).toHaveLength(1);
  });

  it("merges revalidated history without duplicating optimistic messages", () => {
    const current = [CHAT_WELCOME_MESSAGE, message("same", "optimistic")];
    const merged = mergeChatMessages(current, [
      message("same", "optimistic"),
      message("other-device", "new"),
    ]);
    expect(merged.map((item) => item.id)).toEqual([
      CHAT_WELCOME_MESSAGE.id,
      "same",
      "other-device",
    ]);
  });
});
