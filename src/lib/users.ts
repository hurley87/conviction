import "server-only";

import { getSql } from "@/lib/db";
import { normalizeUsername, validateUsername } from "@/lib/usernames";

export { normalizeUsername, validateUsername } from "@/lib/usernames";

export type IdentitySource = "twitter" | "email";

export type UserProfile = {
  privyId: string;
  handle: string | null;
  address: string;
  email: string | null;
  identitySource: IdentitySource;
  onboardingRequired: boolean;
  onboardingCompletedAt: string | null;
  created: boolean;
};

export type InitializeUser = {
  privyId: string;
  address: string;
  email: string | null;
  identitySource: IdentitySource;
  providerHandle: string | null;
};

type UserRow = {
  privy_id: string;
  handle: string | null;
  address: string;
  email: string | null;
  identity_source: IdentitySource;
  onboarding_required: boolean;
  onboarding_completed_at: string | Date | null;
  created?: boolean;
};

export class UserProfileError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "conflict" | "validation" | "not-found",
  ) {
    super(message);
    this.name = "UserProfileError";
  }
}

let schemaReady = false;

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;

  // Adding onboarding_required with a false default backfills every existing
  // row as not requiring onboarding. The final ALTER changes the default only
  // for genuinely new rows created after this migration.
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

function sqlClient() {
  const sql = getSql();
  if (!sql) {
    throw new UserProfileError(
      "Profile storage is not configured.",
      "unavailable",
    );
  }
  return sql;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function toProfile(row: UserRow): UserProfile {
  return {
    privyId: row.privy_id,
    handle: row.handle,
    address: row.address,
    email: row.email,
    identitySource: row.identity_source,
    onboardingRequired:
      row.onboarding_required && !row.onboarding_completed_at,
    onboardingCompletedAt: row.onboarding_completed_at
      ? new Date(row.onboarding_completed_at).toISOString()
      : null,
    created: Boolean(row.created),
  };
}

export async function initializeUser(
  input: InitializeUser,
): Promise<UserProfile> {
  const sql = sqlClient();
  await ensureSchema(sql);
  const providerHandle = input.providerHandle
    ? normalizeUsername(input.providerHandle)
    : null;

  try {
    const rows = await sql`
      INSERT INTO users (
        privy_id,
        handle,
        address,
        email,
        identity_source,
        onboarding_required
      )
      VALUES (
        ${input.privyId},
        ${input.identitySource === "twitter" ? providerHandle : null},
        ${input.address},
        ${input.email},
        ${input.identitySource},
        true
      )
      ON CONFLICT (privy_id)
      DO UPDATE SET
        handle = CASE
          WHEN EXCLUDED.identity_source = 'twitter' THEN EXCLUDED.handle
          ELSE users.handle
        END,
        address = EXCLUDED.address,
        email = COALESCE(EXCLUDED.email, users.email),
        identity_source = CASE
          WHEN EXCLUDED.identity_source = 'twitter' THEN 'twitter'
          ELSE COALESCE(users.identity_source, EXCLUDED.identity_source)
        END,
        updated_at = now()
      RETURNING
        privy_id,
        handle,
        address,
        email,
        identity_source,
        onboarding_required,
        onboarding_completed_at,
        (xmax = 0) AS created
    `;
    return toProfile(rows[0] as UserRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserProfileError(
        "That public username is already in use.",
        "conflict",
      );
    }
    throw error;
  }
}

export async function saveUserHandle(privyId: string, value: string) {
  const validation = validateUsername(value);
  if (!validation.ok) {
    throw new UserProfileError(validation.error, "validation");
  }
  const sql = sqlClient();
  await ensureSchema(sql);
  try {
    const rows = await sql`
      UPDATE users
      SET handle = ${validation.username}, updated_at = now()
      WHERE privy_id = ${privyId} AND identity_source = 'email'
      RETURNING
        privy_id,
        handle,
        address,
        email,
        identity_source,
        onboarding_required,
        onboarding_completed_at,
        false AS created
    `;
    if (!rows[0]) {
      throw new UserProfileError(
        "Only email accounts can choose a public username.",
        "validation",
      );
    }
    return toProfile(rows[0] as UserRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserProfileError(
        "That public username is already in use.",
        "conflict",
      );
    }
    throw error;
  }
}

export async function completeUserOnboarding(privyId: string) {
  const sql = sqlClient();
  await ensureSchema(sql);
  const rows = await sql`
    UPDATE users
    SET
      onboarding_required = false,
      onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
      updated_at = now()
    WHERE privy_id = ${privyId} AND handle IS NOT NULL
    RETURNING
      privy_id,
      handle,
      address,
      email,
      identity_source,
      onboarding_required,
      onboarding_completed_at,
      false AS created
  `;
  if (!rows[0]) {
    throw new UserProfileError(
      "Choose a public username before completing onboarding.",
      "validation",
    );
  }
  return toProfile(rows[0] as UserRow);
}

export function resetUserSchemaForTests() {
  schemaReady = false;
}
