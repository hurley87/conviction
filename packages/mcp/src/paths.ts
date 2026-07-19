import { homedir } from "node:os";
import path from "node:path";

export type ConvictionPaths = {
  root: string;
  profilesDir: string;
  keystoresDir: string;
  /** Durable per-code provisioning state (in-progress and completed). */
  bindingsDir: string;
  /** Durable mock quote / execute / receipt state for serve --mock. */
  mockDir: string;
  /** Local rotating diagnostic logs (stderr mirror; never MCP stdout). */
  logsDir: string;
};

const PROFILE_NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i;

/** Reject path traversal and unsafe profile identifiers. */
export function assertSafeProfileName(profileName: string): string {
  const trimmed = profileName.trim();
  if (!PROFILE_NAME_RE.test(trimmed) || trimmed.includes("..")) {
    throw new Error(
      "invalid --profile name; use letters, numbers, underscores, and hyphens only",
    );
  }
  return trimmed;
}

/** Resolve Conviction home paths, honoring CONVICTION_HOME for tests. */
export function resolveConvictionPaths(home = process.env.CONVICTION_HOME): ConvictionPaths {
  const root = home?.trim()
    ? path.resolve(home)
    : path.join(homedir(), ".conviction");
  return {
    root,
    profilesDir: path.join(root, "profiles"),
    keystoresDir: path.join(root, "keystores"),
    bindingsDir: path.join(root, "bindings"),
    mockDir: path.join(root, "mock"),
    logsDir: path.join(root, "logs"),
  };
}

export function profilePath(paths: ConvictionPaths, profileName: string): string {
  const safe = assertSafeProfileName(profileName);
  return path.join(paths.profilesDir, `${safe}.json`);
}

export function keystorePath(paths: ConvictionPaths, profileName: string): string {
  const safe = assertSafeProfileName(profileName);
  return path.join(paths.keystoresDir, `${safe}.json`);
}

/** Stable path for a provisioning code's local binding (survives successful init). */
export function bindingPath(paths: ConvictionPaths, codeHash: string): string {
  return path.join(paths.bindingsDir, `${codeHash}.json`);
}
