import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { MOCK_TOOLS } from "../src/mock-server.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const executable = path.join(packageRoot, "bin", "conviction-mcp.js");
const cleanup = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function connectMockHost() {
  const home = await mkdtemp(path.join(tmpdir(), "conviction-mcp-test-"));
  cleanup.push(home);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable, "serve", "--mock"],
    cwd: packageRoot,
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "",
      CONVICTION_PRIVATE_KEY: "must-not-be-read-or-logged",
    },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const client = new Client({ name: "conviction-mock-test-host", version: "1.0.0" });
  await client.connect(transport);

  return { client, home, readStderr: () => stderr };
}

describe("Conviction MCP mock host", () => {
  it("starts over stdio and exposes the deterministic mock tools", async () => {
    const { client, home, readStderr } = await connectMockHost();

    try {
      const response = await client.listTools();
      const status = await client.callTool({
        name: "conviction_account_status",
        arguments: {},
      });

      expect(response.tools.map(({ name }) => name)).toEqual(MOCK_TOOLS);
      expect(response.tools.every(({ inputSchema }) => inputSchema.type === "object")).toBe(true);
      expect(status.structuredContent).toEqual({
        ok: true,
        mode: "mock",
        status: "ready",
        funded: false,
        signingAvailable: false,
        agent: {
          handle: "mock-conviction-agent",
          address: null,
        },
      });
      expect(await readdir(home)).toEqual([]);
      expect(readStderr()).toContain("mock server ready on stdio");
      expect(readStderr()).not.toContain("must-not-be-read-or-logged");
    } finally {
      await client.close();
    }
  });

  it("returns the same structured success for repeated mock interactions", async () => {
    const { client } = await connectMockHost();

    try {
      const request = {
        name: "conviction_mock_interaction",
        arguments: { scenario: "success" },
      };

      const first = await client.callTool(request);
      const second = await client.callTool(request);

      expect(first.isError).not.toBe(true);
      expect(first.structuredContent).toEqual({
        ok: true,
        mode: "mock",
        code: "mock_success",
        message: "Conviction MCP mock interaction completed.",
        interactionId: "mock-interaction-001",
      });
      expect(second.structuredContent).toEqual(first.structuredContent);
    } finally {
      await client.close();
    }
  });

  it("returns a stable structured mock error", async () => {
    const { client } = await connectMockHost();

    try {
      const response = await client.callTool({
        name: "conviction_mock_interaction",
        arguments: { scenario: "error" },
      });

      expect(response.isError).toBe(true);
      expect(response.structuredContent).toEqual({
        ok: false,
        mode: "mock",
        code: "mock_error",
        message: "Deterministic mock error requested.",
        interactionId: "mock-interaction-001",
      });
    } finally {
      await client.close();
    }
  });
});
