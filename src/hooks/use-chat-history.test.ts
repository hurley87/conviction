import { describe, expect, it } from "vitest";
import {
  pageLocalTranscript,
  readLocalTranscript,
} from "@/hooks/use-chat-history";
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

describe("versioned local chat history", () => {
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
    };
    const transcript = readLocalTranscript(storage);
    const latest = pageLocalTranscript(transcript);
    expect(latest.messages).toHaveLength(100);
    expect(latest.messages[0].text).toBe("message 6");
    const earlier = pageLocalTranscript(transcript, latest.nextCursor);
    expect(earlier.messages.map((message) => message.text)).toEqual([
      "message 1",
      "message 2",
      "message 3",
      "message 4",
      "message 5",
    ]);
  });
});
