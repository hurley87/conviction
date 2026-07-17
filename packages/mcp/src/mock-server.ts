import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import {
  accountStatusResult,
  mockAccountStatusOutputSchema,
  mockInteractionInputSchema,
  mockInteractionOutputSchema,
  mockInteractionResult,
  type MockInteractionScenario,
} from "./mock-fixtures.js";
import { toolResult } from "./tool-result.js";

const mockReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const MOCK_TOOL_DEFINITIONS = [
  {
    name: "conviction_account_status",
    title: "Get mock Conviction account status",
    description:
      "Return deterministic mock account state without accessing a live account.",
    inputSchema: {},
    outputSchema: mockAccountStatusOutputSchema,
    annotations: mockReadOnlyAnnotations,
    handler: async () => toolResult(accountStatusResult()),
  },
  {
    name: "conviction_mock_interaction",
    title: "Run a deterministic mock interaction",
    description:
      "Return a structured deterministic success or error for host integration checks.",
    inputSchema: mockInteractionInputSchema,
    outputSchema: mockInteractionOutputSchema,
    annotations: mockReadOnlyAnnotations,
    handler: async ({ scenario }: { scenario: MockInteractionScenario }) => {
      const structuredContent = mockInteractionResult(scenario);
      return toolResult(structuredContent, !structuredContent.ok);
    },
  },
] as const;

export const MOCK_TOOLS = MOCK_TOOL_DEFINITIONS.map((tool) => tool.name);

export function createMockServer(): McpServer {
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

  for (const tool of MOCK_TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      },
      tool.handler,
    );
  }

  return server;
}
