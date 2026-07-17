import { AgentLeaseError } from "@/lib/agent-lease";

/** Parse a JSON object body for agent lease routes; empty body → {}. */
export function parseAgentJsonObject(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new AgentLeaseError(
        "invalid_request",
        "Request body must be a JSON object.",
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AgentLeaseError) throw error;
    throw new AgentLeaseError(
      "invalid_request",
      "Request body must be valid JSON.",
    );
  }
}
