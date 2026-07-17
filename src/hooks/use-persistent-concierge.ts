"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChatHistory } from "@/hooks/use-chat-history";
import { useConciergeCore } from "@/hooks/use-concierge-core";
import type { ChatMessage } from "@/lib/chat-types";
import type { UAClient } from "@/lib/ua";
import type { TradeSigners, UniversalBalance } from "@/lib/verbs/types";

/**
 * Owns the glue between the concierge phase machine and durable chat history
 * so the panel stays a pure view.
 */
export function usePersistentConcierge({
  ua,
  balance,
  signers,
  handle,
  onUpgraded,
  active,
  live,
  getAccessToken,
}: {
  ua: UAClient;
  balance: UniversalBalance;
  signers: TradeSigners;
  handle: string | null;
  onUpgraded?: () => void;
  active: boolean;
  live: boolean;
  getAccessToken?: () => Promise<string | null>;
}) {
  const enqueueRef = useRef<(message: ChatMessage) => void>(() => {});
  const persistMessage = useCallback((message: ChatMessage) => {
    enqueueRef.current(message);
  }, []);

  const core = useConciergeCore(ua, balance, signers, handle, {
    onUpgraded,
    onMessage: persistMessage,
  });

  const { replaceMessages, mergeMessages, prependMessages, clearTranscript } =
    core;

  const history = useChatHistory({
    active,
    live,
    getAccessToken,
    onReplace: replaceMessages,
    onMerge: mergeMessages,
  });

  useEffect(() => {
    enqueueRef.current = history.enqueue;
  }, [history.enqueue]);

  const loadEarlier = useCallback(async () => {
    const earlier = await history.loadEarlier();
    if (earlier.length > 0) prependMessages(earlier);
    return earlier;
  }, [history, prependMessages]);

  const clearChat = useCallback(async () => {
    const cleared = await history.clear();
    if (!cleared) return false;
    clearTranscript();
    return true;
  }, [clearTranscript, history]);

  return {
    ...core,
    history,
    loadEarlier,
    clearChat,
  };
}
