import "server-only";

import { getSql } from "@/lib/db";
import {
  ensureUserSchema,
  resetUserSchemaForTests,
} from "@/lib/users-schema";
import type { IdentitySource } from "@/lib/identity";
import { mergeUserColumns } from "@/lib/user-identity";
import { validateUsername } from "@/lib/usernames";

export type { IdentitySource } from "@/lib/identity";
export { normalizeUsername, validateUsername } from "@/lib/usernames";
export { resetUserSchemaForTests };

export type UserProfile = {
  privyId: string;
  handle: string | null;
  address: string;
  email: string | null;
  identitySource: IdentitySource;
  /** Single client-facing onboarding truth derived from storage columns. */
  onboardingRequired: boolean;
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
    // Existing users were backfilled with onboarding_required=false; new users
    // stay required until completeUserOnboarding clears the flag.
    onboardingRequired:
      row.onboarding_required && !row.onboarding_completed_at,
    created: Boolean(row.created),
  };
}

async function getUserRow(
  sql: NonNullable<ReturnType<typeof getSql>>,
  privyId: string,
) {
  const rows = await sql`
    SELECT
      privy_id,
      handle,
      address,
      email,
      identity_source,
      onboarding_required,
      onboarding_completed_at
    FROM users
    WHERE privy_id = ${privyId}
  `;
  return (rows[0] as UserRow | undefined) ?? null;
}

export async function initializeUser(
  input: InitializeUser,
): Promise<UserProfile> {
  const sql = sqlClient();
  await ensureUserSchema(sql);

  const existing = await getUserRow(sql, input.privyId);
  const next = mergeUserColumns(
    existing
      ? {
          handle: existing.handle,
          email: existing.email,
          identitySource: existing.identity_source,
        }
      : null,
    input,
  );

  try {
    if (!existing) {
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
          ${next.handle},
          ${next.address},
          ${next.email},
          ${next.identitySource},
          true
        )
        RETURNING
          privy_id,
          handle,
          address,
          email,
          identity_source,
          onboarding_required,
          onboarding_completed_at,
          true AS created
      `;
      return toProfile(rows[0] as UserRow);
    }

    const rows = await sql`
      UPDATE users
      SET
        handle = ${next.handle},
        address = ${next.address},
        email = ${next.email},
        identity_source = ${next.identitySource},
        updated_at = now()
      WHERE privy_id = ${input.privyId}
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
    return toProfile(rows[0] as UserRow);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Concurrent first login: retry as an update after the other writer wins.
      if (!existing) return initializeUser(input);
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
  await ensureUserSchema(sql);
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
    if (error instanceof UserProfileError) throw error;
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
  await ensureUserSchema(sql);
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
