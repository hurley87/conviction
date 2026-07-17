import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMockServer } from "./mock-server.js";

const HELP = `Conviction MCP

Usage:
  conviction-mcp serve --mock

Commands:
  serve --mock   Start the deterministic mock server over stdio
  help           Show this help

Mock mode uses no account, credentials, signer, or signing material.`;

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args.includes("--help")) {
    console.log(HELP);
    return;
  }

  if (args.length !== 2 || args[0] !== "serve" || args[1] !== "--mock") {
    throw new Error(
      "unsupported command; use `conviction-mcp serve --mock` or `conviction-mcp help`",
    );
  }

  const server = createMockServer();
  const transport = new StdioServerTransport();

  // stdout is reserved for MCP protocol frames. Diagnostics belong on stderr.
  console.error("Conviction MCP mock server ready on stdio");
  await server.connect(transport);
}
