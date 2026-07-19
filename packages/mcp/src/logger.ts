import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { resolveConvictionPaths } from "./paths.js";

/** Local diagnostic retention (ADR 0036 / PRD §15). */
export const LOG_RETENTION_DAYS = 30;

/** Rotate when a single day file exceeds this size. */
export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export type LogLevel = "info" | "warn" | "error";

export type LoggerOptions = {
  home?: string;
  /** Override stderr writer (tests). */
  writeStderr?: (line: string) => void;
  /** Override file append (tests). */
  appendFile?: (filePath: string, data: string) => Promise<void>;
  now?: () => Date;
};

function dayStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isSensitiveFieldKey(key: string): boolean {
  return /(password|passphrase|secret|private[_-]?key|authorization|token)/i.test(
    key,
  );
}

function redact(value: string): string {
  return value
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[redacted-hex]")
    .replace(
      /("?(?:password|passphrase|secret|privateKey|authorization)"?\s*[:=]\s*")[^"]+"/gi,
      '$1[redacted]"',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}

function redactFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (isSensitiveFieldKey(key)) {
        return [key, "[redacted]"];
      }
      if (typeof value === "string") {
        return [key, redact(value)];
      }
      return [key, value];
    }),
  );
}

/**
 * Stderr + rotating local file logger. Never writes to stdout (MCP protocol only).
 */
export class ConvictionLogger {
  private readonly home: string | undefined;
  private readonly writeStderr: (line: string) => void;
  private readonly appendFileImpl: (filePath: string, data: string) => Promise<void>;
  private readonly now: () => Date;
  private pruneScheduled = false;

  constructor(options: LoggerOptions = {}) {
    this.home = options.home;
    this.writeStderr =
      options.writeStderr ?? ((line) => console.error(line));
    this.appendFileImpl =
      options.appendFile ?? ((filePath, data) => appendFile(filePath, data, "utf8"));
    this.now = options.now ?? (() => new Date());
  }

  /** Opaque correlation id for one tool call / request chain. */
  static newCorrelationId(): string {
    return randomUUID();
  }

  async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write("info", message, fields);
  }

  async warn(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write("warn", message, fields);
  }

  async error(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write("error", message, fields);
  }

  private async write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    const when = this.now();
    const payload = {
      ts: when.toISOString(),
      level,
      message: redact(message),
      ...(fields ? { fields: redactFields(fields) } : {}),
    };
    const line = JSON.stringify(payload);
    this.writeStderr(line);

    try {
      const paths = resolveConvictionPaths(this.home);
      await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
      const filePath = await this.resolveLogFile(paths.logsDir, when);
      await this.appendFileImpl(filePath, `${line}\n`);
      void this.pruneOldLogs(paths.logsDir, when);
    } catch {
      // File logging is best-effort; stderr already has the line.
    }
  }

  private async resolveLogFile(logsDir: string, when: Date): Promise<string> {
    const base = `mcp-${dayStamp(when)}.log`;
    const primary = path.join(logsDir, base);
    try {
      const info = await stat(primary);
      if (info.size < LOG_ROTATE_BYTES) return primary;
    } catch {
      return primary;
    }
    const suffix = createHash("sha256")
      .update(`${when.toISOString()}-${randomUUID()}`)
      .digest("hex")
      .slice(0, 8);
    return path.join(logsDir, `mcp-${dayStamp(when)}.${suffix}.log`);
  }

  private async pruneOldLogs(logsDir: string, when: Date): Promise<void> {
    if (this.pruneScheduled) return;
    this.pruneScheduled = true;
    try {
      const cutoff = when.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const entries = await readdir(logsDir);
      for (const entry of entries) {
        if (!entry.startsWith("mcp-") || !entry.endsWith(".log")) continue;
        const full = path.join(logsDir, entry);
        try {
          const info = await stat(full);
          if (info.mtimeMs < cutoff) await unlink(full);
        } catch {
          // ignore per-file failures
        }
      }
    } catch {
      // ignore prune failures
    } finally {
      this.pruneScheduled = false;
    }
  }
}

let defaultLogger: ConvictionLogger | null = null;

export function getConvictionLogger(options?: LoggerOptions): ConvictionLogger {
  if (options) return new ConvictionLogger(options);
  if (!defaultLogger) defaultLogger = new ConvictionLogger();
  return defaultLogger;
}

/** Test helper. */
export function resetConvictionLoggerForTests(): void {
  defaultLogger = null;
}
