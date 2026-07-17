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
  getAccessToken: () => Promise<string | null>;
}): ChatHistoryBackend {
  if (!live) {
    return createLocalChatHistory(window.localStorage);
  }
  return createApiChatHistory(async (input, init) => {
    const token = await getAccessToken();
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
  const [booted, setBooted] = useState(false);

  const conversationIdRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const backendRef = useRef<ChatHistoryBackend | null>(null);
  const queueRef = useRef<FifoSaveQueue<QueuedMessage> | null>(null);
  const latestRef = useRef({
    getAccessToken,
    onReplace,
    onMerge,
  });

  useEffect(() => {
    latestRef.current.getAccessToken = getAccessToken;
    latestRef.current.onReplace = onReplace;
    latestRef.current.onMerge = onMerge;
  }, [getAccessToken, onMerge, onReplace]);

  useEffect(() => {
    if (backendRef.current && queueRef.current) return;

    const backend = createBackend({
      live,
      getAccessToken: () =>
        latestRef.current.getAccessToken?.() ?? Promise.resolve(null),
    });
    const queue = new FifoSaveQueue<QueuedMessage>(
      () => async ({ conversationId, message }) => {
        await backend.append(conversationId, message);
      },
      setSaveStatus,
    );
    backendRef.current = backend;
    queueRef.current = queue;
    setBooted(true);
  }, [live]);

  const revalidate = useCallback(async () => {
    const backend = backendRef.current;
    const queue = queueRef.current;
    if (!backend || !queue) return;

    setLoading(true);
    try {
      const page = await backend.loadPage();
      conversationIdRef.current = page.conversationId;
      setNextCursor(page.nextCursor);
      if (initializedRef.current) latestRef.current.onMerge(page.messages);
      else latestRef.current.onReplace(page.messages);
      initializedRef.current = true;
      setReady(true);
      if (queue.pending().length === 0) setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !booted) return;
    const timeout = window.setTimeout(() => void revalidate(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, booted, revalidate]);

  const enqueue = useCallback((message: ChatMessage) => {
    const queue = queueRef.current;
    const conversationId = conversationIdRef.current;
    if (!queue || !conversationId) {
      setSaveStatus("error");
      return;
    }
    queue.enqueue({ conversationId, message });
  }, []);

  const retry = useCallback(() => {
    const queue = queueRef.current;
    if (queue && queue.pending().length > 0) {
      void queue.retry();
      return;
    }
    void revalidate();
  }, [revalidate]);

  const loadEarlier = useCallback(async () => {
    const backend = backendRef.current;
    if (!backend || !nextCursor || loadingEarlier) return [];
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
  }, [loadingEarlier, nextCursor]);

  const clear = useCallback(async () => {
    const backend = backendRef.current;
    const queue = queueRef.current;
    if (!backend || !queue || clearing) return false;
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
  }, [clearing]);

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
