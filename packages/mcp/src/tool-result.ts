import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toolResult(
  structuredContent: Record<string, unknown>,
  isError = false,
): CallToolResult {
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
