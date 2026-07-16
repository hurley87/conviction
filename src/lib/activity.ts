// User activity store — trades and other wallet events persisted for the
// Activity timeline. Mirrors convictions.ts: Neon when configured, in-memory
// fallback for local/mock dev.

import "server-only";
import { getSql } from "@/lib/db";

export type ActivityKind = "trade" | "deposit" | "send";

export type ActivityEntry = {
  id: string;
  handle: string;
  kind: ActivityKind;
  summary: string;
  amountUsd: number | null;
  receiptSlug: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const memoryStore = new Map<string, ActivityEntry>();
let schemaReady = false;

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS activity (
      id            text PRIMARY KEY,
      handle        text NOT NULL,
      kind          text NOT NULL,
      summary       text NOT NULL,
      amount_usd    numeric,
      receipt_slug  text,
      metadata      jsonb NOT NULL DEFAULT '{}',
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS activity_by_handle_created
    ON activity (handle, created_at DESC)
  `;
  schemaReady = true;
}

function rowToEntry(row: {
  id: string;
  handle: string;
  kind: string;
  summary: string;
  amount_usd: string | number | null;
  receipt_slug: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}): ActivityEntry {
  return {
    id: row.id,
    handle: row.handle,
    kind: row.kind as ActivityKind,
    summary: row.summary,
    amountUsd:
      row.amount_usd != null ? Number(row.amount_usd) : null,
    receiptSlug: row.receipt_slug ?? null,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Persist an activity row. Insert-once: a colliding id is ignored so retries
 * stay idempotent and clients cannot overwrite another row by picking its id.
 */
export async function saveActivity(entry: ActivityEntry): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    if (!memoryStore.has(entry.id)) {
      memoryStore.set(entry.id, entry);
    }
    return false;
  }
  await ensureSchema(sql);
  await sql`
    INSERT INTO activity (id, handle, kind, summary, amount_usd, receipt_slug, metadata, created_at)
    VALUES (
      ${entry.id},
      ${entry.handle},
      ${entry.kind},
      ${entry.summary},
      ${entry.amountUsd},
      ${entry.receiptSlug},
      ${JSON.stringify(entry.metadata)}::jsonb,
      ${entry.createdAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  return true;
}

export async function listActivityByHandle(
  handle: string,
  limit = 50,
): Promise<ActivityEntry[]> {
  const sql = getSql();
  if (!sql) {
    return [...memoryStore.values()]
      .filter((e) => e.handle === handle)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
  }
  await ensureSchema(sql);
  const rows = await sql`
    SELECT id, handle, kind, summary, amount_usd, receipt_slug, metadata, created_at
    FROM activity
    WHERE handle = ${handle}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as Parameters<typeof rowToEntry>[0][]).map(rowToEntry);
}

/** Test helper — reset in-memory store between tests. */
export function resetActivityMemoryForTests() {
  memoryStore.clear();
  schemaReady = false;
}
