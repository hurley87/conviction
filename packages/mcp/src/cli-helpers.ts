import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";

/** Default encrypted backup path used when `--backup-path` is omitted. */
export const DEFAULT_BACKUP_PATH = "~/conviction-signer.backup.json";

/** Expand a leading `~/` to the user home directory. */
export function expandHomePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveDefaultBackupPath(
  backupPath: string | undefined,
): string {
  return expandHomePath(backupPath?.trim() || DEFAULT_BACKUP_PATH);
}

/**
 * Resolve Conviction API base URL.
 * Order: `--api-base` → `CONVICTION_API_BASE` → profile.apiBaseUrl → localhost.
 */
export function resolveApiBaseUrl(options: {
  flagValue?: string | undefined;
  env?: NodeJS.ProcessEnv;
  profileApiBaseUrl?: string | undefined;
}): string {
  const env = options.env ?? process.env;
  return (
    options.flagValue?.trim() ||
    env.CONVICTION_API_BASE?.trim() ||
    options.profileApiBaseUrl?.trim() ||
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

/** Prompt for a recovery passphrase on a TTY; never echo input. */
export async function promptBackupPassphrase(
  options: {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<string> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stderr;
  if (!stdin.isTTY) {
    throw new Error(
      "missing recovery passphrase; pass --backup-passphrase or set CONVICTION_BACKUP_PASSPHRASE",
    );
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const wasRaw = stdin.isRaw === true;
  try {
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    const passphrase = await new Promise<string>((resolve, reject) => {
      stdout.write(
        "Enter recovery passphrase for the encrypted signer backup (input hidden): ",
      );
      let buffer = "";
      const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        for (const char of text) {
          if (char === "\n" || char === "\r" || char === "\u0004") {
            stdin.off("data", onData);
            stdout.write("\n");
            resolve(buffer);
            return;
          }
          if (char === "\u0003") {
            stdin.off("data", onData);
            reject(new Error("cancelled"));
            return;
          }
          if (char === "\u007f" || char === "\b") {
            buffer = buffer.slice(0, -1);
            continue;
          }
          buffer += char;
        }
      };
      stdin.on("data", onData);
    });
    if (!passphrase.trim()) {
      throw new Error(
        "missing recovery passphrase; pass --backup-passphrase or set CONVICTION_BACKUP_PASSPHRASE",
      );
    }
    return passphrase;
  } finally {
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(wasRaw);
    }
    rl.close();
  }
}
