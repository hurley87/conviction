import { homedir } from "node:os";
import path from "node:path";

export type ConvictionPaths = {
  root: string;
  profilesDir: string;
  keystoresDir: string;
  /** Durable per-code provisioning state (in-progress and completed). */
  bindingsDir: string;
};

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
  };
}

export function profilePath(paths: ConvictionPaths, profileName: string): string {
  return path.join(paths.profilesDir, `${profileName}.json`);
}

export function keystorePath(paths: ConvictionPaths, profileName: string): string {
  return path.join(paths.keystoresDir, `${profileName}.json`);
}

/** Stable path for a provisioning code's local binding (survives successful init). */
export function bindingPath(paths: ConvictionPaths, codeHash: string): string {
  return path.join(paths.bindingsDir, `${codeHash}.json`);
}
