import {
  CHAT_PAGE_SIZE,
  type ChatMessage,
  type ChatPage,
} from "@/lib/chat-types";

export type ChatHistoryBackend = {
  loadPage(before?: string | null): Promise<ChatPage>;
  append(conversationId: string, message: ChatMessage): Promise<void>;
  clear(): Promise<{ conversationId: string }>;
};

export type AuthenticatedFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const LOCAL_KEY = "conviction.chat.v1";
const LOCAL_VERSION = 1;

type LocalTranscript = {
  version: 1;
  conversationId: string;
  messages: ChatMessage[];
  nextSequence: number;
};

function freshLocalTranscript(): LocalTranscript {
  return {
    version: LOCAL_VERSION,
    conversationId: crypto.randomUUID(),
    messages: [],
    nextSequence: 1,
  };
}

export function readLocalTranscript(storage: Pick<Storage, "getItem">) {
  try {
    const raw = storage.getItem(LOCAL_KEY);
    if (!raw) return freshLocalTranscript();
    const parsed = JSON.parse(raw) as Partial<LocalTranscript>;
    if (
      parsed.version !== LOCAL_VERSION ||
      typeof parsed.conversationId !== "string" ||
      !Array.isArray(parsed.messages) ||
      typeof parsed.nextSequence !== "number"
    ) {
      return freshLocalTranscript();
    }
    const messages = parsed.messages.filter(
      (message): message is ChatMessage =>
        typeof message?.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.text === "string" &&
        typeof message.createdAt === "string",
    );
    return { ...parsed, messages } as LocalTranscript;
  } catch {
    return freshLocalTranscript();
  }
}

function writeLocalTranscript(
  storage: Pick<Storage, "setItem">,
  transcript: LocalTranscript,
) {
  storage.setItem(LOCAL_KEY, JSON.stringify(transcript));
}

export function pageLocalTranscript(
  transcript: LocalTranscript,
  before?: string | null,
): ChatPage {
  const beforeSequence = before ? Number(before) : Number.POSITIVE_INFINITY;
  const eligible = transcript.messages.filter(
    (message) => Number(message.sequence) < beforeSequence,
  );
  const messages = eligible.slice(-CHAT_PAGE_SIZE);
  return {
    conversationId: transcript.conversationId,
    messages,
    nextCursor:
      eligible.length > messages.length ? (messages[0]?.sequence ?? null) : null,
  };
}

function ensureLocalTranscript(
  storage: Pick<Storage, "getItem" | "setItem">,
): LocalTranscript {
  const raw = storage.getItem(LOCAL_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<LocalTranscript>;
      if (
        parsed.version === LOCAL_VERSION &&
        typeof parsed.conversationId === "string" &&
        Array.isArray(parsed.messages) &&
        typeof parsed.nextSequence === "number"
      ) {
        return readLocalTranscript(storage);
      }
    } catch {
      // Fall through and mint a fresh transcript.
    }
  }
  const transcript = freshLocalTranscript();
  writeLocalTranscript(storage, transcript);
  return transcript;
}

export function createLocalChatHistory(
  storage: Pick<Storage, "getItem" | "setItem">,
): ChatHistoryBackend {
  return {
    loadPage(before) {
      return Promise.resolve(
        pageLocalTranscript(ensureLocalTranscript(storage), before),
      );
    },
    async append(conversationId, message) {
      const transcript = ensureLocalTranscript(storage);
      if (transcript.conversationId !== conversationId) {
        throw new Error("The local chat was cleared.");
      }
      if (!transcript.messages.some((stored) => stored.id === message.id)) {
        transcript.messages.push({
          ...message,
          sequence: String(transcript.nextSequence),
        });
        transcript.nextSequence += 1;
        writeLocalTranscript(storage, transcript);
      }
    },
    async clear() {
      const transcript = freshLocalTranscript();
      writeLocalTranscript(storage, transcript);
      return { conversationId: transcript.conversationId };
    },
  };
}

export function createApiChatHistory(
  authenticatedFetch: AuthenticatedFetch,
): ChatHistoryBackend {
  return {
    async loadPage(before) {
      const query = before ? `?before=${encodeURIComponent(before)}` : "";
      const response = await authenticatedFetch(`/api/chat${query}`);
      if (!response.ok) throw new Error("Could not load chat history.");
      return (await response.json()) as ChatPage;
    },
    async append(conversationId, message) {
      const response = await authenticatedFetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          id: message.id,
          role: message.role,
          text: message.text,
        }),
      });
      if (!response.ok) throw new Error("Could not save chat history.");
    },
    async clear() {
      const response = await authenticatedFetch("/api/chat", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not clear chat history.");
      return (await response.json()) as { conversationId: string };
    },
  };
}
