import { getAgentAuditStore } from "@/lib/agent-audit";
import {
  enableAgentBySigner,
  privatePausedReason,
} from "@/lib/agent-policy";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";

/**
 * POST /api/agents/lifecycle/enable
 * Agent-signer authenticated re-enable used by `conviction-mcp enable`.
 * Not an MCP tool.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/lifecycle/enable",
      store,
      nonceStore: getAgentNonceStore(),
    });

    const result = await enableAgentBySigner({
      store,
      auditStore: getAgentAuditStore(),
      agent: verified.agent,
    });

    return Response.json(
      {
        agent: result.agent,
        releasedPermitCount: result.releasedPermitCount,
        privatePausedReason: privatePausedReason(result.agent),
      },
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
      const status =
        error.code === "agent_not_found"
          ? 404
          : error.code === "lifecycle_blocked"
            ? 409
            : 422;
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Agent enable is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
