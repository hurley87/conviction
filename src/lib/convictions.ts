// Conviction feed store (issue #4). Mirrors receipts.ts: Neon when configured,
// in-memory fallback with seed for local/mock dev (ADR 0008).

import "server-only";
import { SEED_CONVICTION } from "@/lib/conviction-seed";
import { getSql } from "@/lib/db";
import { appendBacker } from "@/lib/verbs/conviction";
import type {
  ConvictionEntry,
  GateCheck,
  WhyNowEvent,
} from "@/lib/verbs/types";

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
      created_at    timestamptz NOT NULL DEFAULT now(),
      why_now       jsonb,
      what_breaks_it text,
      gate_report   jsonb
    )
  `;
  // Existing Neon DBs created before anatomy columns — add if missing.
  await sql`
    ALTER TABLE convictions
      ADD COLUMN IF NOT EXISTS why_now jsonb,
      ADD COLUMN IF NOT EXISTS what_breaks_it text,
      ADD COLUMN IF NOT EXISTS gate_report jsonb
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
  why_now: WhyNowEvent[] | null;
  what_breaks_it: string | null;
  gate_report: GateCheck[] | null;
}): ConvictionEntry {
  return {
    entryId: row.entry_id,
    handle: row.handle,
    thesis: row.thesis,
    trade: row.trade,
    receiptSlug: row.receipt_slug ?? undefined,
    backedBy: row.backed_by ?? [],
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.why_now && row.why_now.length > 0 ? { whyNow: row.why_now } : {}),
    ...(row.what_breaks_it ? { whatBreaksIt: row.what_breaks_it } : {}),
    ...(row.gate_report && row.gate_report.length > 0
      ? { gateReport: row.gate_report }
      : {}),
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
    INSERT INTO convictions (
      entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at,
      why_now, what_breaks_it, gate_report
    )
    VALUES (
      ${entry.entryId},
      ${entry.handle},
      ${entry.thesis},
      ${JSON.stringify(entry.trade)}::jsonb,
      ${entry.receiptSlug ?? null},
      ${entry.backedBy},
      ${entry.createdAt},
      ${entry.whyNow ? JSON.stringify(entry.whyNow) : null}::jsonb,
      ${entry.whatBreaksIt ?? null},
      ${entry.gateReport ? JSON.stringify(entry.gateReport) : null}::jsonb
    )
    ON CONFLICT (entry_id) DO UPDATE SET
      handle = EXCLUDED.handle,
      thesis = EXCLUDED.thesis,
      trade = EXCLUDED.trade,
      receipt_slug = EXCLUDED.receipt_slug,
      backed_by = EXCLUDED.backed_by,
      why_now = EXCLUDED.why_now,
      what_breaks_it = EXCLUDED.what_breaks_it,
      gate_report = EXCLUDED.gate_report
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
    SELECT entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at,
           why_now, what_breaks_it, gate_report
    FROM convictions
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as Parameters<typeof rowToEntry>[0][]).map(rowToEntry);
}

export async function listConvictionsByHandle(
  handle: string,
  limit = 50,
): Promise<ConvictionEntry[]> {
  const sql = getSql();
  if (!sql) {
    ensureMemorySeed();
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
    SELECT entry_id, handle, thesis, trade, receipt_slug, backed_by, created_at,
           why_now, what_breaks_it, gate_report
    FROM convictions
    WHERE handle = ${handle}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as Parameters<typeof rowToEntry>[0][]).map(rowToEntry);
}

/** Append a backer's handle to a conviction entry. Returns updated backedBy or null if missing. */
export async function addBacker(
  entryId: string,
  handle: string,
): Promise<string[] | null> {
  const trimmed = handle.trim();
  if (!trimmed) return null;

  const sql = getSql();
  if (!sql) {
    ensureMemorySeed();
    const entry = memoryStore.get(entryId);
    if (!entry) return null;
    const updated = appendBacker(entry.backedBy, trimmed);
    entry.backedBy = updated;
    memoryStore.set(entryId, entry);
    return updated;
  }

  await ensureSchema(sql);
  const updated = await sql`
    UPDATE convictions
    SET backed_by = array_append(backed_by, ${trimmed})
    WHERE entry_id = ${entryId}
      AND NOT (${trimmed} = ANY(backed_by))
    RETURNING backed_by
  `;
  if (updated.length > 0) {
    return (updated[0] as { backed_by: string[] }).backed_by;
  }

  const existing = await sql`
    SELECT backed_by FROM convictions WHERE entry_id = ${entryId}
  `;
  if (existing.length === 0) return null;
  return (existing[0] as { backed_by: string[] }).backed_by;
}

/** Test helper — reset in-memory store between tests. */
export function resetConvictionsMemoryForTests() {
  memoryStore.clear();
  memorySeeded = false;
  schemaReady = false;
}
