import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

export const MOCK_TOOLS = [
  "conviction_account_status",
  "conviction_mock_interaction",
];

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function toolResult(structuredContent, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

export function createMockServer() {
  const server = new McpServer(
    {
      name: "conviction-mcp",
      version: "1.0.0",
    },
    {
      instructions:
        "Deterministic mock mode only. It uses no account, credentials, signer, signing material, network services, or real funds.",
    },
  );

  server.registerTool(
    "conviction_account_status",
    {
      title: "Get mock Conviction account status",
      description:
        "Return deterministic mock account state without accessing a live account.",
      inputSchema: {},
      outputSchema: {
        ok: z.literal(true),
        mode: z.literal("mock"),
        status: z.literal("ready"),
        funded: z.literal(false),
        signingAvailable: z.literal(false),
        agent: z.object({
          handle: z.literal("mock-conviction-agent"),
          address: z.null(),
        }),
      },
      annotations,
    },
    async () =>
      toolResult({
        ok: true,
        mode: "mock",
        status: "ready",
        funded: false,
        signingAvailable: false,
        agent: {
          handle: "mock-conviction-agent",
          address: null,
        },
      }),
  );

  server.registerTool(
    "conviction_mock_interaction",
    {
      title: "Run a deterministic mock interaction",
      description:
        "Return a structured deterministic success or error for host integration checks.",
      inputSchema: {
        scenario: z.enum(["success", "error"]).default("success"),
      },
      outputSchema: {
        ok: z.boolean(),
        mode: z.literal("mock"),
        code: z.enum(["mock_success", "mock_error"]),
        message: z.string(),
        interactionId: z.literal("mock-interaction-001"),
      },
      annotations,
    },
    async ({ scenario }) => {
      if (scenario === "error") {
        return toolResult(
          {
            ok: false,
            mode: "mock",
            code: "mock_error",
            message: "Deterministic mock error requested.",
            interactionId: "mock-interaction-001",
          },
          true,
        );
      }

      return toolResult({
        ok: true,
        mode: "mock",
        code: "mock_success",
        message: "Conviction MCP mock interaction completed.",
        interactionId: "mock-interaction-001",
      });
    },
  );

  return server;
}
