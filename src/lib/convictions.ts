// Conviction feed store (issue #4). Mirrors receipts.ts: Neon when configured,
// in-memory fallback with seed for local/mock dev (ADR 0008).

import "server-only";
import { SEED_CONVICTION } from "@/lib/conviction-seed";
import { getSql } from "@/lib/db";
import type { ConvictionEntry } from "@/lib/verbs/types";

const memoryStore = new Map<string, ConvictionEntry>();
let memorySeeded = false;
let schemaReady = false;

function ensureMemorySeed() {
  if (memorySeeded) return;
  memoryStore.set(SEED_CONVICTION.entryId, SEED_CONVICTION);
  memorySeeded = true;
}

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS convictions (
      entry_id      text PRIMARY KEY,
      handle        text NOT NULL,
      thesis        text NOT NULL,
      trade         jsonb NOT NULL,
      receipt_slug  text,
      backed_by     text[] NOT NULL DEFAULT '{}',
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    INSERT INTO convictions (entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at)
    VALUES (
      ${SEED_CONVICTION.entryId},
      ${SEED_CONVICTION.handle},
      ${SEED_CONVICTION.thesis},
      ${JSON.stringify(SEED_CONVICTION.trade)}::jsonb,
      ${SEED_CONVICTION.receiptSlug ?? null},
      ${SEED_CONVICTION.backedBy},
      ${SEED_CONVICTION.createdAt}
    )
    ON CONFLICT (entry_id) DO NOTHING
  `;
  schemaReady = true;
}

function rowToEntry(row: {
  entry_id: string;
  handle: string;
  thesis: string;
  trade: ConvictionTradeRow;
  receipt_slug: string | null;
  backed_by: string[];
  created_at: string;
}): ConvictionEntry {
  return {
    entryId: row.entry_id,
    handle: row.handle,
    thesis: row.thesis,
    trade: row.trade,
    receiptSlug: row.receipt_slug ?? undefined,
    backedBy: row.backed_by ?? [],
    createdAt: new Date(row.created_at).toISOString(),
  };
}

type ConvictionTradeRow = ConvictionEntry["trade"];

export async function saveConviction(
  entry: ConvictionEntry,
): Promise<boolean> {
  const sql = getSql();
  if (!sql) {
    ensureMemorySeed();
    memoryStore.set(entry.entryId, entry);
    return false;
  }
  await ensureSchema(sql);
  await sql`
    INSERT INTO convictions (entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at)
    VALUES (
      ${entry.entryId},
      ${entry.handle},
      ${entry.thesis},
      ${JSON.stringify(entry.trade)}::jsonb,
      ${entry.receiptSlug ?? null},
      ${entry.backedBy},
      ${entry.createdAt}
    )
    ON CONFLICT (entry_id) DO UPDATE SET
      handle = EXCLUDED.handle,
      thesis = EXCLUDED.thesis,
      trade = EXCLUDED.trade,
      receipt_slug = EXCLUDED.receipt_slug,
      backed_by = EXCLUDED.backed_by
  `;
  return true;
}

export async function listConvictions(
  limit = 50,
): Promise<ConvictionEntry[]> {
  const sql = getSql();
  if (!sql) {
    ensureMemorySeed();
    return [...memoryStore.values()]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
  }
  await ensureSchema(sql);
  const rows = await sql`
    SELECT entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at
    FROM convictions
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as Parameters<typeof rowToEntry>[0][]).map(rowToEntry);
}

/** Test helper — reset in-memory store between tests. */
export function resetConvictionsMemoryForTests() {
  memoryStore.clear();
  memorySeeded = false;
  schemaReady = false;
}
