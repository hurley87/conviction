/** Neutral parse failure for agent API JSON bodies — routes map to their own errors. */
export class AgentApiBodyError extends Error {
  readonly code = "invalid_request" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentApiBodyError";
  }
}

/** Parse a JSON object body for agent API routes; empty body → {}. */
export function parseAgentJsonObject(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new AgentApiBodyError("Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AgentApiBodyError) throw error;
    throw new AgentApiBodyError("Request body must be valid JSON.");
  }
}
