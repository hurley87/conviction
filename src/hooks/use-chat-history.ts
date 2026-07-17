"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FifoSaveQueue, type ChatSaveStatus } from "@/lib/chat-save-queue";
import type { ChatMessage } from "@/lib/chat-types";

const LOCAL_KEY = "conviction.chat.v1";
const LOCAL_VERSION = 1;
const PAGE_SIZE = 100;

type ChatPage = {
  conversationId: string;
  messages: ChatMessage[];
  nextCursor: string | null;
};

type QueuedMessage = {
  conversationId: string;
  message: ChatMessage;
};

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
  const messages = eligible.slice(-PAGE_SIZE);
  return {
    conversationId: transcript.conversationId,
    messages,
    nextCursor:
      eligible.length > messages.length ? messages[0]?.sequence ?? null : null,
  };
}

export function useChatHistory({
  active,
  live,
  getAccessToken,
  onHydrate,
}: {
  active: boolean;
  live: boolean;
  getAccessToken?: () => Promise<string | null>;
  onHydrate: (messages: ChatMessage[], mode: "replace" | "merge") => void;
}) {
  const [saveStatus, setSaveStatus] = useState<ChatSaveStatus>("saved");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const authenticatedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = await getAccessToken?.();
      if (!token) throw new Error("No active Privy access token.");
      return fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          authorization: `Bearer ${token}`,
        },
      });
    },
    [getAccessToken],
  );

  const saveItem = useCallback(
    async ({ conversationId, message }: QueuedMessage) => {
      if (!live) {
        const transcript = readLocalTranscript(window.localStorage);
        if (transcript.conversationId !== conversationId) {
          throw new Error("The local chat was cleared.");
        }
        if (!transcript.messages.some((stored) => stored.id === message.id)) {
          transcript.messages.push({
            ...message,
            sequence: String(transcript.nextSequence),
          });
          transcript.nextSequence += 1;
          writeLocalTranscript(window.localStorage, transcript);
        }
        return;
      }
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
    [authenticatedFetch, live],
  );

  const [queue] = useState(
    () => new FifoSaveQueue<QueuedMessage>(saveItem, setSaveStatus),
  );

  const loadPage = useCallback(
    async (before?: string | null) => {
      if (!live) {
        return pageLocalTranscript(
          readLocalTranscript(window.localStorage),
          before,
        );
      }
      const query = before ? `?before=${encodeURIComponent(before)}` : "";
      const response = await authenticatedFetch(`/api/chat${query}`);
      if (!response.ok) throw new Error("Could not load chat history.");
      return (await response.json()) as ChatPage;
    },
    [authenticatedFetch, live],
  );

  const revalidate = useCallback(async () => {
    setLoading(true);
    try {
      const page = await loadPage();
      conversationIdRef.current = page.conversationId;
      setNextCursor(page.nextCursor);
      onHydrate(
        page.messages,
        initializedRef.current ? "merge" : "replace",
      );
      initializedRef.current = true;
      setReady(true);
      if (queue.pending().length === 0) setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    } finally {
      setLoading(false);
    }
  }, [loadPage, onHydrate, queue]);

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void revalidate(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, revalidate]);

  const enqueue = useCallback((message: ChatMessage) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId) {
      setSaveStatus("error");
      return;
    }
    queue.enqueue({ conversationId, message });
  }, [queue]);

  const retry = useCallback(() => {
    if (queue.pending().length > 0) {
      void queue.retry();
    } else {
      void revalidate();
    }
  }, [queue, revalidate]);

  const loadEarlier = useCallback(async () => {
    if (!nextCursor || loadingEarlier) return [];
    setLoadingEarlier(true);
    try {
      const page = await loadPage(nextCursor);
      setNextCursor(page.nextCursor);
      return page.messages;
    } catch {
      setSaveStatus("error");
      return [];
    } finally {
      setLoadingEarlier(false);
    }
  }, [loadPage, loadingEarlier, nextCursor]);

  const clear = useCallback(async () => {
    if (clearing) return false;
    setClearing(true);
    const pending = queue.pending();
    queue.reset();
    try {
      let conversationId: string;
      if (live) {
        const response = await authenticatedFetch("/api/chat", {
          method: "DELETE",
        });
        if (!response.ok) throw new Error("Could not clear chat history.");
        conversationId = ((await response.json()) as { conversationId: string })
          .conversationId;
      } else {
        const transcript = freshLocalTranscript();
        writeLocalTranscript(window.localStorage, transcript);
        conversationId = transcript.conversationId;
      }
      conversationIdRef.current = conversationId;
      setNextCursor(null);
      initializedRef.current = true;
      setSaveStatus("saved");
      return true;
    } catch {
      queue.enqueueMany(pending);
      setSaveStatus("error");
      return false;
    } finally {
      setClearing(false);
    }
  }, [authenticatedFetch, clearing, live, queue]);

  return {
    saveStatus,
    ready,
    loading,
    loadingEarlier,
    clearing,
    hasEarlier: nextCursor != null,
    enqueue,
    retry,
    loadEarlier,
    clear,
  };
}
