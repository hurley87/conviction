/** Canonical public username transform for user-entered email identities. */
export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 20) {
    return { ok: false as const, username, error: "Use 3 to 20 characters." };
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return {
      ok: false as const,
      username,
      error: "Use lowercase letters, numbers, and underscores only.",
    };
  }
  return { ok: true as const, username };
}
