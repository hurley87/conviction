// Upsert a user's Twitter-handle identity on login (ADR 0009). Secrets stay
// server-side here; the client only posts non-sensitive identity fields.

import { upsertUser } from "@/lib/users";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { privyId, handle, address } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof privyId !== "string" ||
    typeof handle !== "string" ||
    typeof address !== "string"
  ) {
    return Response.json(
      { error: "privyId, handle and address are required" },
      { status: 400 },
    );
  }

  const persisted = await upsertUser({ privyId, handle, address });
  return Response.json({ persisted });
}
