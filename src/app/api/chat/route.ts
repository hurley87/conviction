import { z } from "zod";
import { ChatAuthError, requirePrivyUserId } from "@/lib/chat-auth";
import {
  appendChatMessage,
  ChatStoreUnavailableError,
  clearChat,
  getChatPage,
  IdempotencyConflictError,
  StaleConversationError,
} from "@/lib/chat-store";

const appendSchema = z
  .object({
    conversationId: z.uuid(),
    id: z.uuid(),
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(20_000),
  })
  .strict();

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

function errorResponse(error: unknown) {
  if (error instanceof ChatAuthError) {
    return Response.json(
      { error: error.message },
      { status: error.status, headers: NO_STORE_HEADERS },
    );
  }
  if (error instanceof ChatStoreUnavailableError) {
    return Response.json(
      { error: error.message },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (error instanceof StaleConversationError) {
    return Response.json(
      { error: error.message, code: "stale_conversation" },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  if (error instanceof IdempotencyConflictError) {
    return Response.json(
      { error: error.message, code: "idempotency_conflict" },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
  console.error("Chat API failed", error);
  return Response.json(
    { error: "Chat history is temporarily unavailable." },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  try {
    const ownerId = await requirePrivyUserId(request);
    const value = new URL(request.url).searchParams.get("before");
    let before: bigint | undefined;
    if (value != null) {
      if (!/^\d+$/.test(value) || BigInt(value) < BigInt(1)) {
        return Response.json(
          { error: "before must be a positive message cursor" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      before = BigInt(value);
    }
    const page = await getChatPage(ownerId, before);
    return Response.json(page, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = await requirePrivyUserId(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid JSON" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const parsed = appendSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid chat message" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const message = await appendChatMessage(ownerId, parsed.data);
    return Response.json({ message }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ownerId = await requirePrivyUserId(request);
    const conversationId = await clearChat(ownerId);
    return Response.json(
      { conversationId },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
