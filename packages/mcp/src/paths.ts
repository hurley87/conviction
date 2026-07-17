import { homedir } from "node:os";
import path from "node:path";

export type ConvictionPaths = {
  root: string;
  profilesDir: string;
  keystoresDir: string;
  incompleteDir: string;
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
    incompleteDir: path.join(root, "incomplete"),
  };
}

export function profilePath(paths: ConvictionPaths, profileName: string): string {
  return path.join(paths.profilesDir, `${profileName}.json`);
}

export function keystorePath(paths: ConvictionPaths, profileName: string): string {
  return path.join(paths.keystoresDir, `${profileName}.json`);
}

export function incompletePath(paths: ConvictionPaths, codeHash: string): string {
  return path.join(paths.incompleteDir, `${codeHash}.json`);
}
