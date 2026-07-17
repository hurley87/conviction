import { buildAgentAccountStatus } from "@/lib/agent-lease";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";

function provisioningErrorStatus(
  code: AgentProvisioningError["code"],
): number {
  switch (code) {
    case "agent_not_found":
      return 404;
    case "setup_not_ready":
    case "lifecycle_blocked":
      return 409;
    case "invalid_request":
      return 422;
    default:
      return 503;
  }
}

/** Record a successful non-value-moving doctor connection check. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/setup-verify",
      store,
      nonceStore: getAgentNonceStore(),
    });

    const agent = await store.markSetupVerified({
      agentId: verified.agent.agentId,
      now: new Date(),
    });

    return Response.json(
      { status: buildAgentAccountStatus(agent) },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    if (error instanceof AgentProvisioningError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: provisioningErrorStatus(error.code) },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Setup verification is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
