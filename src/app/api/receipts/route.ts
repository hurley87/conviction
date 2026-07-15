// Persist / look up receipts for shareable permalinks (ADR 0013).

import { getStoredReceiptRecord, saveReceipt } from "@/lib/receipts";
import type { Receipt } from "@/lib/verbs/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return Response.json({ error: "slug required" }, { status: 400 });
  }

  const record = await getStoredReceiptRecord(slug);
  if (!record) {
    return Response.json({ error: "receipt not found" }, { status: 404 });
  }

  return Response.json({
    receipt: record.receipt,
    entryAt: record.entryAt,
  });
}

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
