import "server-only";

import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";

export const CHAT_PAGE_SIZE = 100;

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  sequence: string;
  createdAt: string;
};

export type ChatPage = {
  conversationId: string;
  messages: StoredChatMessage[];
  nextCursor: string | null;
};

export type AppendChatMessage = Pick<StoredChatMessage, "id" | "role" | "text"> & {
  conversationId: string;
};

export class ChatStoreUnavailableError extends Error {
  constructor() {
    super("Chat persistence is not configured.");
    this.name = "ChatStoreUnavailableError";
  }
}

export class StaleConversationError extends Error {
  constructor() {
    super("The chat was cleared before this message was saved.");
    this.name = "StaleConversationError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The message id is already in use with different content.");
    this.name = "IdempotencyConflictError";
  }
}

type MemoryConversation = {
  id: string;
  messages: StoredChatMessage[];
};

const memoryStore = new Map<string, MemoryConversation>();
let memorySequence = BigInt(0);
let schemaReady = false;

function shouldUseMemoryStore() {
  return process.env.NODE_ENV === "test";
}

function requireSql() {
  const sql = getSql();
  if (sql) return sql;
  if (shouldUseMemoryStore()) return null;
  throw new ChatStoreUnavailableError();
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      owner_id        text PRIMARY KEY,
      conversation_id text NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      sequence        bigserial PRIMARY KEY,
      owner_id        text NOT NULL,
      conversation_id text NOT NULL,
      message_id      text NOT NULL,
      role            text NOT NULL CHECK (role IN ('user', 'assistant')),
      text            text NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (owner_id, conversation_id, message_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chat_messages_by_conversation_sequence
    ON chat_messages (owner_id, conversation_id, sequence DESC)
  `;
  schemaReady = true;
}

function getMemoryConversation(ownerId: string) {
  const existing = memoryStore.get(ownerId);
  if (existing) return existing;
  const created = { id: randomUUID(), messages: [] };
  memoryStore.set(ownerId, created);
  return created;
}

function rowToMessage(row: {
  message_id: string;
  role: string;
  text: string;
  sequence: string | number;
  created_at: string;
}): StoredChatMessage {
  return {
    id: row.message_id,
    role: row.role as StoredChatMessage["role"],
    text: row.text,
    sequence: String(row.sequence),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function ensureConversation(
  sql: NonNullable<ReturnType<typeof getSql>>,
  ownerId: string,
) {
  const candidate = randomUUID();
  await sql`
    INSERT INTO chat_conversations (owner_id, conversation_id)
    VALUES (${ownerId}, ${candidate})
    ON CONFLICT (owner_id) DO NOTHING
  `;
  const rows = await sql`
    SELECT conversation_id
    FROM chat_conversations
    WHERE owner_id = ${ownerId}
    LIMIT 1
  `;
  return (rows[0] as { conversation_id: string }).conversation_id;
}

export async function getChatPage(
  ownerId: string,
  before?: bigint,
): Promise<ChatPage> {
  const sql = requireSql();
  if (!sql) {
    const conversation = getMemoryConversation(ownerId);
    const eligible = before
      ? conversation.messages.filter((message) => BigInt(message.sequence) < before)
      : conversation.messages;
    const descending = [...eligible].reverse().slice(0, CHAT_PAGE_SIZE + 1);
    const hasMore = descending.length > CHAT_PAGE_SIZE;
    const messages = descending.slice(0, CHAT_PAGE_SIZE).reverse();
    return {
      conversationId: conversation.id,
      messages,
      nextCursor: hasMore ? messages[0]?.sequence ?? null : null,
    };
  }

  await ensureSchema(sql);
  const conversationId = await ensureConversation(sql, ownerId);
  const limit = CHAT_PAGE_SIZE + 1;
  const rows = before
    ? await sql`
        SELECT message_id, role, text, sequence, created_at
        FROM chat_messages
        WHERE owner_id = ${ownerId}
          AND conversation_id = ${conversationId}
          AND sequence < ${before.toString()}
        ORDER BY sequence DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT message_id, role, text, sequence, created_at
        FROM chat_messages
        WHERE owner_id = ${ownerId}
          AND conversation_id = ${conversationId}
        ORDER BY sequence DESC
        LIMIT ${limit}
      `;
  const descending = (rows as Parameters<typeof rowToMessage>[0][]).map(
    rowToMessage,
  );
  const hasMore = descending.length > CHAT_PAGE_SIZE;
  const messages = descending.slice(0, CHAT_PAGE_SIZE).reverse();
  return {
    conversationId,
    messages,
    nextCursor: hasMore ? messages[0]?.sequence ?? null : null,
  };
}

export async function appendChatMessage(
  ownerId: string,
  input: AppendChatMessage,
): Promise<StoredChatMessage> {
  const sql = requireSql();
  if (!sql) {
    const conversation = getMemoryConversation(ownerId);
    if (conversation.id !== input.conversationId) {
      throw new StaleConversationError();
    }
    const existing = conversation.messages.find(
      (message) => message.id === input.id,
    );
    if (existing) {
      if (existing.role !== input.role || existing.text !== input.text) {
        throw new IdempotencyConflictError();
      }
      return existing;
    }
    memorySequence += BigInt(1);
    const message: StoredChatMessage = {
      id: input.id,
      role: input.role,
      text: input.text,
      sequence: memorySequence.toString(),
      createdAt: new Date().toISOString(),
    };
    conversation.messages.push(message);
    return message;
  }

  await ensureSchema(sql);
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO chat_messages (
        owner_id,
        conversation_id,
        message_id,
        role,
        text
      )
      SELECT
        ${ownerId},
        ${input.conversationId},
        ${input.id},
        ${input.role},
        ${input.text}
      WHERE EXISTS (
        SELECT 1
        FROM chat_conversations
        WHERE owner_id = ${ownerId}
          AND conversation_id = ${input.conversationId}
      )
      ON CONFLICT (owner_id, conversation_id, message_id) DO NOTHING
      RETURNING message_id, role, text, sequence, created_at
    )
    SELECT message_id, role, text, sequence, created_at
    FROM inserted
    UNION ALL
    SELECT message_id, role, text, sequence, created_at
    FROM chat_messages
    WHERE owner_id = ${ownerId}
      AND conversation_id = ${input.conversationId}
      AND message_id = ${input.id}
    LIMIT 1
  `;
  const row = rows[0] as Parameters<typeof rowToMessage>[0] | undefined;
  if (!row) throw new StaleConversationError();
  const message = rowToMessage(row);
  if (message.role !== input.role || message.text !== input.text) {
    throw new IdempotencyConflictError();
  }
  return message;
}

export async function clearChat(ownerId: string): Promise<string> {
  const sql = requireSql();
  const conversationId = randomUUID();
  if (!sql) {
    memoryStore.set(ownerId, { id: conversationId, messages: [] });
    return conversationId;
  }

  await ensureSchema(sql);
  await sql`
    WITH rotated AS (
      INSERT INTO chat_conversations (owner_id, conversation_id)
      VALUES (${ownerId}, ${conversationId})
      ON CONFLICT (owner_id)
      DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
                    updated_at = now()
      RETURNING owner_id
    )
    DELETE FROM chat_messages
    WHERE owner_id IN (SELECT owner_id FROM rotated)
  `;
  return conversationId;
}

export function resetChatMemoryForTests() {
  memoryStore.clear();
  memorySequence = BigInt(0);
  schemaReady = false;
}
