export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  sequence?: string;
};

export const CHAT_WELCOME_MESSAGE: ChatMessage = {
  id: "local-welcome-v1",
  role: "assistant",
  text: 'What would you like to do? For example: "Move $25 to cash", "Convert half my ETH to cash", or "Summarize the feed".',
  createdAt: "1970-01-01T00:00:00.000Z",
};

export const INTERRUPTED_QUOTE_NOTICE =
  "That quote was interrupted and can’t be resumed. Check Activity for any completed transaction, then ask for a fresh quote.";

const RESTORED_QUOTE_PROMPTS = new Set([
  "Here's your quote — review and confirm below.",
  "The price moved since you last saw it — please review the updated quote and confirm again.",
]);

export function createChatMessage(
  message: Pick<ChatMessage, "role" | "text">,
): ChatMessage {
  return {
    ...message,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

export function restoreChatMessages(messages: ChatMessage[]) {
  const restored = [CHAT_WELCOME_MESSAGE, ...messages];
  const last = messages.at(-1);
  if (!last || !RESTORED_QUOTE_PROMPTS.has(last.text)) {
    return { messages: restored, interruption: null };
  }
  const interruption = createChatMessage({
    role: "assistant",
    text: INTERRUPTED_QUOTE_NOTICE,
  });
  return { messages: [...restored, interruption], interruption };
}

export function mergeChatMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
) {
  const seen = new Set(current.map((message) => message.id));
  return [
    ...current,
    ...incoming.filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    }),
  ];
}

export function prependChatMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
) {
  const seen = new Set(current.map((message) => message.id));
  return [
    current[0]?.id === CHAT_WELCOME_MESSAGE.id ? current[0] : CHAT_WELCOME_MESSAGE,
    ...incoming.filter((message) => !seen.has(message.id)),
    ...current.filter((message) => message.id !== CHAT_WELCOME_MESSAGE.id),
  ];
}
