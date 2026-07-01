// Intent parsing endpoint. Runs the LLM parser server-side so the AI Gateway key
// never reaches the client; the client hook posts raw text and gets back the same
// constrained ParseResult the deterministic parser produces.

import { parseIntentLLM } from "@/lib/verbs/intent-llm";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") {
    return Response.json({ error: "text required" }, { status: 400 });
  }

  const result = await parseIntentLLM(text);
  return Response.json(result);
}
