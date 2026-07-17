import {
  agentAuthErrorResponse,
  authenticateAgentGet,
  unavailableResponse,
} from "@/lib/agent-api-route";
import { loadAgentAccountStatus } from "@/lib/agent-account-status";

export async function GET(request: Request) {
  try {
    const agent = await authenticateAgentGet({
      request,
      path: "/api/agents/status",
    });
    return Response.json(
      { status: await loadAgentAccountStatus(agent) },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = agentAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return unavailableResponse("Agent status is temporarily unavailable.");
  }
}
