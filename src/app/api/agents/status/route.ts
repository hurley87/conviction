import { buildAgentAccountStatus } from "@/lib/agent-lease";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";

export async function GET(request: Request) {
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody: "",
      path: "/api/agents/status",
      store,
      nonceStore: getAgentNonceStore(),
    });
    return Response.json(
      { status: buildAgentAccountStatus(verified.agent) },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Agent status is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
