// User identity store. A user's feed identity is their Twitter handle (ADR
// 0009), keyed by their Privy id and associated with their EOA = UA address.

import "server-only";
import { getSql } from "@/lib/db";

export type UpsertUser = {
  privyId: string;
  handle: string;
  address: string;
};

let schemaReady = false;

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      privy_id    text PRIMARY KEY,
      handle      text NOT NULL,
      address     text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  schemaReady = true;
}

/**
 * Upsert a user on login. Returns false when no DB is configured (local/mock
 * dev) so callers can no-op gracefully.
 */
export async function upsertUser({
  privyId,
  handle,
  address,
}: UpsertUser): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  await ensureSchema(sql);
  await sql`
    INSERT INTO users (privy_id, handle, address)
    VALUES (${privyId}, ${handle}, ${address})
    ON CONFLICT (privy_id)
    DO UPDATE SET handle = EXCLUDED.handle,
                  address = EXCLUDED.address,
                  updated_at = now()
  `;
  return true;
}
