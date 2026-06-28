// Neon serverless Postgres — the shared feed/identity store both surfaces use
// (ADR 0009). Server-only: DATABASE_URL is a secret, never NEXT_PUBLIC.

import "server-only";
import { neon } from "@neondatabase/serverless";

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Returns a SQL client, or null when DATABASE_URL is unset (local/mock dev). */
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}
