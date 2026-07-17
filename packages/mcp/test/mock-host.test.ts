import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";

import { MOCK_ACCOUNT_STATUS } from "../src/mock-fixtures.js";
import { MOCK_TOOLS } from "../src/mock-server.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const executable = path.join(packageRoot, "bin", "conviction-mcp.js");
const cleanup: string[] = [];

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
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const client = new Client({ name: "conviction-mock-test-host", version: "1.0.0" });
  await client.connect(transport);

  return { client, home, readStderr: () => stderr };
}

describe("Conviction MCP mock host", () => {
  it("starts over stdio, lists mock tools, and stays credential-free", async () => {
    const { client, home, readStderr } = await connectMockHost();

    try {
      const response = await client.listTools();
      const status = await client.callTool({
        name: "conviction_account_status",
        arguments: {},
      });

      expect(response.tools.map(({ name }) => name)).toEqual([...MOCK_TOOLS]);
      expect(response.tools.every(({ inputSchema }) => inputSchema.type === "object")).toBe(true);
      expect(status.structuredContent).toEqual(MOCK_ACCOUNT_STATUS);
      expect(await readdir(home)).toEqual([]);
      expect(readStderr()).toContain("mock server ready on stdio");
      expect(readStderr()).not.toContain("must-not-be-read-or-logged");
    } finally {
      await client.close();
    }
  });
});
