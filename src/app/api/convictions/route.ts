// Conviction feed API (issue #4): post + list + back.

import { addBacker, saveConviction, listConvictions, listConvictionsByHandle } from "@/lib/convictions";
import {
  buildConviction,
  parseConvictionTrade,
} from "@/lib/verbs/conviction";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle");

  const convictions = handle
    ? await listConvictionsByHandle(handle)
    : await listConvictions();

  return Response.json({ entries: convictions });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const payload = body as {
    handle?: unknown;
    thesis?: unknown;
    trade?: unknown;
    receiptSlug?: unknown;
  };

  if (typeof payload.handle !== "string" || !payload.handle.trim()) {
    return Response.json({ error: "handle required" }, { status: 400 });
  }
  if (typeof payload.thesis !== "string" || !payload.thesis.trim()) {
    return Response.json({ error: "thesis required" }, { status: 400 });
  }

  const trade = parseConvictionTrade(payload.trade);
  if (!trade) {
    return Response.json({ error: "invalid trade payload" }, { status: 400 });
  }

  const receiptSlug =
    typeof payload.receiptSlug === "string" ? payload.receiptSlug : undefined;

  const entry = buildConviction({
    handle: payload.handle.trim(),
    thesis: payload.thesis,
    trade,
    receiptSlug,
  });

  const persisted = await saveConviction(entry);
  return Response.json({ entryId: entry.entryId, persisted });
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const payload = body as { entryId?: unknown; handle?: unknown };

  if (typeof payload.entryId !== "string" || !payload.entryId.trim()) {
    return Response.json({ error: "entryId required" }, { status: 400 });
  }
  if (typeof payload.handle !== "string" || !payload.handle.trim()) {
    return Response.json({ error: "handle required" }, { status: 400 });
  }

  const backedBy = await addBacker(
    payload.entryId.trim(),
    payload.handle.trim(),
  );
  if (!backedBy) {
    return Response.json({ error: "conviction not found" }, { status: 404 });
  }

  return Response.json({ backedBy });
}
