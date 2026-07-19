import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConvictionLogger,
  LOG_RETENTION_DAYS,
  resetConvictionLoggerForTests,
} from "../src/logger.js";
import { resolveConvictionPaths } from "../src/paths.js";

const cleanup: string[] = [];

afterEach(async () => {
  resetConvictionLoggerForTests();
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ConvictionLogger", () => {
  it("writes redacted diagnostics to stderr and a rotating log file, never implying stdout use", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-logger-"));
    cleanup.push(home);
    const stderr: string[] = [];
    const logger = new ConvictionLogger({
      home,
      writeStderr: (line) => stderr.push(line),
    });

    const correlationId = ConvictionLogger.newCorrelationId();
    await logger.info("mcp_tool_start", {
      tool: "conviction_account_status",
      correlationId,
      password: "must-not-leak",
      rootHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("mcp_tool_start");
    expect(stderr[0]).toContain(correlationId);
    expect(stderr[0]).not.toContain("must-not-leak");
    expect(stderr[0]).toContain("0x[redacted-hex]");

    const logsDir = resolveConvictionPaths(home).logsDir;
    const files = await readdir(logsDir);
    expect(files.some((name) => name.startsWith("mcp-") && name.endsWith(".log"))).toBe(
      true,
    );
    const content = await readFile(path.join(logsDir, files[0]!), "utf8");
    expect(content).toContain("mcp_tool_start");
    expect(content).not.toContain("must-not-leak");
    expect(LOG_RETENTION_DAYS).toBe(30);
  });
});
