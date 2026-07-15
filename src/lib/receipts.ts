// Receipt store for shareable permalinks (ADR 0013). Mirrors users.ts pattern:
// Neon when DATABASE_URL is set, in-memory fallback for local/mock dev.

import "server-only";
import { getSql } from "@/lib/db";
import type { Receipt } from "@/lib/verbs/types";

type MemoryReceipt = { receipt: Receipt; createdAt: string };

const memoryStore = new Map<string, MemoryReceipt>();

let schemaReady = false;

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS receipts (
      slug        text PRIMARY KEY,
      payload     jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  schemaReady = true;
}

export async function saveReceipt(receipt: Receipt): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    memoryStore.set(receipt.slug, {
      receipt,
      createdAt: new Date().toISOString(),
    });
    return false;
  }
  await ensureSchema(sql);
  await sql`
    INSERT INTO receipts (slug, payload)
    VALUES (${receipt.slug}, ${JSON.stringify(receipt)}::jsonb)
    ON CONFLICT (slug) DO UPDATE SET payload = EXCLUDED.payload
  `;
  return true;
}

/** One store read — receipt payload + entry timestamp. */
export async function getStoredReceiptRecord(
  slug: string,
): Promise<{ receipt: Receipt; entryAt: string } | null> {
  const sql = getSql();
  if (!sql) {
    const stored = memoryStore.get(slug);
    if (!stored) return null;
    return { receipt: stored.receipt, entryAt: stored.createdAt };
  }
  await ensureSchema(sql);
  const rows = await sql`
    SELECT payload, created_at FROM receipts WHERE slug = ${slug} LIMIT 1
  `;
  const row = rows[0] as
    | { payload: Receipt; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    receipt: row.payload,
    entryAt: new Date(row.created_at).toISOString(),
  };
}

export async function getStoredReceipt(
  slug: string,
): Promise<Receipt | null> {
  const record = await getStoredReceiptRecord(slug);
  return record?.receipt ?? null;
}

/**
 * Entry timestamp for a receipt — when the position landed onchain / was
 * persisted. Used so desk cards can enforce entry ≤ publication (issue #27).
 */
export async function getReceiptEntryAt(
  slug: string,
): Promise<string | null> {
  const record = await getStoredReceiptRecord(slug);
  return record?.entryAt ?? null;
}

/** Test helper — reset in-memory store between tests. */
export function resetReceiptsMemoryForTests() {
  memoryStore.clear();
  schemaReady = false;
}
