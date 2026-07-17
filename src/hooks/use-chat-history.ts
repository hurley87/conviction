"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createApiChatHistory,
  createLocalChatHistory,
  type ChatHistoryBackend,
} from "@/lib/chat-history-backend";
import { FifoSaveQueue, type ChatSaveStatus } from "@/lib/chat-save-queue";
import type { ChatMessage } from "@/lib/chat-types";

type QueuedMessage = {
  conversationId: string;
  message: ChatMessage;
};

function createBackend({
  live,
  getAccessToken,
}: {
  live: boolean;
  getAccessToken?: () => Promise<string | null>;
}): ChatHistoryBackend {
  if (!live) {
    return createLocalChatHistory(window.localStorage);
  }
  return createApiChatHistory(async (input, init) => {
    const token = await getAccessToken?.();
    if (!token) throw new Error("No active Privy access token.");
    return fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        authorization: `Bearer ${token}`,
      },
    });
  });
}

export function useChatHistory({
  active,
  live,
  getAccessToken,
  onReplace,
  onMerge,
}: {
  active: boolean;
  live: boolean;
  getAccessToken?: () => Promise<string | null>;
  onReplace: (messages: ChatMessage[]) => void;
  onMerge: (messages: ChatMessage[]) => void;
}) {
  const [saveStatus, setSaveStatus] = useState<ChatSaveStatus>("saved");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const [backend] = useState(() =>
    createBackend({
      live,
      getAccessToken: () =>
        getAccessTokenRef.current?.() ?? Promise.resolve(null),
    }),
  );

  const saveItem = useCallback(
    async ({ conversationId, message }: QueuedMessage) => {
      await backend.append(conversationId, message);
    },
    [backend],
  );
  const saveItemRef = useRef(saveItem);
  saveItemRef.current = saveItem;

  const [queue] = useState(
    () =>
      new FifoSaveQueue<QueuedMessage>(
        () => saveItemRef.current,
        setSaveStatus,
      ),
  );

  const revalidate = useCallback(async () => {
    setLoading(true);
    try {
      const page = await backend.loadPage();
      conversationIdRef.current = page.conversationId;
      setNextCursor(page.nextCursor);
      if (initializedRef.current) onMerge(page.messages);
      else onReplace(page.messages);
      initializedRef.current = true;
      setReady(true);
      if (queue.pending().length === 0) setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    } finally {
      setLoading(false);
    }
  }, [backend, onMerge, onReplace, queue]);

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void revalidate(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, revalidate]);

  const enqueue = useCallback(
    (message: ChatMessage) => {
      const conversationId = conversationIdRef.current;
      if (!conversationId) {
        setSaveStatus("error");
        return;
      }
      queue.enqueue({ conversationId, message });
    },
    [queue],
  );

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
      const page = await backend.loadPage(nextCursor);
      setNextCursor(page.nextCursor);
      return page.messages;
    } catch {
      setSaveStatus("error");
      return [];
    } finally {
      setLoadingEarlier(false);
    }
  }, [backend, loadingEarlier, nextCursor]);

  const clear = useCallback(async () => {
    if (clearing) return false;
    setClearing(true);
    const pending = queue.pending();
    queue.reset();
    try {
      const { conversationId } = await backend.clear();
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
  }, [backend, clearing, queue]);

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
