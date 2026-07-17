import "server-only";

import type { getSql } from "@/lib/db";

let schemaReady = false;

/**
 * One-shot users table migration. Existing rows must not be forced through
 * onboarding: ADD COLUMN defaults false, then the default flips to true only
 * for rows created after this migration.
 */
export async function ensureUserSchema(
  sql: NonNullable<ReturnType<typeof getSql>>,
) {
  if (schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      privy_id                 text PRIMARY KEY,
      handle                   text,
      address                  text NOT NULL,
      email                    text,
      identity_source          text,
      onboarding_required      boolean NOT NULL DEFAULT true,
      onboarding_completed_at timestamptz,
      created_at               timestamptz NOT NULL DEFAULT now(),
      updated_at               timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE users ALTER COLUMN handle DROP NOT NULL`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_source text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_required boolean DEFAULT false`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz`;
  await sql`UPDATE users SET identity_source = 'twitter' WHERE identity_source IS NULL AND handle IS NOT NULL`;
  await sql`UPDATE users SET onboarding_required = false WHERE onboarding_required IS NULL`;
  await sql`ALTER TABLE users ALTER COLUMN onboarding_required SET NOT NULL`;
  await sql`ALTER TABLE users ALTER COLUMN onboarding_required SET DEFAULT true`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_unique ON users (lower(handle)) WHERE handle IS NOT NULL`;
  schemaReady = true;
}

export function resetUserSchemaForTests() {
  schemaReady = false;
}
