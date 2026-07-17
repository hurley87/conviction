import { loadAgentAccountStatus } from "@/lib/agent-account-status";
import { runAgentGetRoute } from "@/lib/agent-api-route";

export async function GET(request: Request) {
  return runAgentGetRoute({
    request,
    path: "/api/agents/status",
    handler: async (agent) => ({
      status: await loadAgentAccountStatus(agent),
    }),
    fallbackMessage: "Agent status is temporarily unavailable.",
  });
}
