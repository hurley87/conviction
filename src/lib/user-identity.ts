import type { IdentitySource } from "@/lib/identity";
import { normalizeUsername } from "@/lib/usernames";

export type InitializeUserIdentity = {
  address: string;
  email: string | null;
  identitySource: IdentitySource;
  providerHandle: string | null;
};

export type ExistingUserIdentity = {
  handle: string | null;
  email: string | null;
  identitySource: IdentitySource;
};

export type MergedUserColumns = {
  handle: string | null;
  address: string;
  email: string | null;
  identitySource: IdentitySource;
};

/**
 * Twitter provider handle always wins; email identities keep any chosen handle.
 * Pure so profile writes can upsert flat columns instead of SQL CASE soup.
 */
export function mergeUserColumns(
  existing: ExistingUserIdentity | null,
  incoming: InitializeUserIdentity,
): MergedUserColumns {
  const providerHandle = incoming.providerHandle
    ? normalizeUsername(incoming.providerHandle)
    : null;

  if (incoming.identitySource === "twitter") {
    return {
      handle: providerHandle,
      address: incoming.address,
      email: incoming.email ?? existing?.email ?? null,
      identitySource: "twitter",
    };
  }

  return {
    handle: existing?.handle ?? null,
    address: incoming.address,
    email: incoming.email ?? existing?.email ?? null,
    identitySource: existing?.identitySource ?? incoming.identitySource,
  };
}
