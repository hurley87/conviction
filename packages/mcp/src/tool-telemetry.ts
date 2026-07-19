import { ConvictionLogger } from "./logger.js";

export type ToolTelemetryResult = {
  isError?: boolean;
};

/**
 * One adapter for MCP tool correlation + duration logging.
 * Handlers receive correlationId; outcomes are logged whether they throw or
 * return an MCP `isError` result.
 */
export async function withToolTelemetry<T>(options: {
  tool: string;
  logger: ConvictionLogger;
  run: (correlationId: string) => Promise<T>;
}): Promise<T> {
  const correlationId = ConvictionLogger.newCorrelationId();
  const started = Date.now();
  await options.logger.info("mcp_tool_start", {
    tool: options.tool,
    correlationId,
  });
  try {
    const result = await options.run(correlationId);
    const isError =
      result !== null &&
      typeof result === "object" &&
      "isError" in result &&
      (result as ToolTelemetryResult).isError === true;
    await options.logger.info("mcp_tool_end", {
      tool: options.tool,
      correlationId,
      ok: !isError,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await options.logger.error("mcp_tool_end", {
      tool: options.tool,
      correlationId,
      ok: false,
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : "tool failed",
    });
    throw error;
  }
}
