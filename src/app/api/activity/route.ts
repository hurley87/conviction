import { listActivityByHandle, saveActivity, type ActivityEntry } from "@/lib/activity";

export const dynamic = "force-dynamic";

type PostBody = {
  /** Optional stable id (e.g. Particle transfer transactionId) for idempotent sends. */
  id?: string;
  handle?: string;
  kind?: ActivityEntry["kind"];
  summary?: string;
  amountUsd?: number | null;
  receiptSlug?: string | null;
  metadata?: Record<string, unknown>;
};

function isValidKind(kind: unknown): kind is ActivityEntry["kind"] {
  return kind === "trade" || kind === "deposit" || kind === "send";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const handle = searchParams.get("handle");

  if (!handle) {
    return Response.json({ error: "handle required" }, { status: 400 });
  }

  const entries = await listActivityByHandle(handle);
  return Response.json({ entries });
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const { id, handle, kind, summary, amountUsd, receiptSlug, metadata } = body;

  if (!handle || typeof handle !== "string") {
    return Response.json({ error: "handle required" }, { status: 400 });
  }
  if (!isValidKind(kind)) {
    return Response.json({ error: "invalid kind" }, { status: 400 });
  }
  if (!summary || typeof summary !== "string") {
    return Response.json({ error: "summary required" }, { status: 400 });
  }
  if (id != null && (typeof id !== "string" || !id.trim())) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const entry: ActivityEntry = {
    id:
      id?.trim() ||
      `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    handle,
    kind,
    summary,
    amountUsd: amountUsd ?? null,
    receiptSlug: receiptSlug ?? null,
    metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  };

  await saveActivity(entry);
  return Response.json({ entry }, { status: 201 });
}
