// Persist a receipt for its shareable permalink (ADR 0013).

import { saveReceipt } from "@/lib/receipts";
import type { Receipt } from "@/lib/verbs/types";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const receipt = body as Receipt;
  if (
    typeof receipt?.slug !== "string" ||
    typeof receipt?.summary !== "string" ||
    !Array.isArray(receipt?.legs)
  ) {
    return Response.json({ error: "invalid receipt payload" }, { status: 400 });
  }

  const persisted = await saveReceipt(receipt);
  return Response.json({ persisted, slug: receipt.slug });
}
