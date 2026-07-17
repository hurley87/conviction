import {
  AgentLeaseError,
  leaseErrorStatus,
  renewAgentLease,
} from "@/lib/agent-lease";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/lease/renew",
      store,
      nonceStore: getAgentNonceStore(),
    });

    const parsed = rawBody.trim()
      ? (JSON.parse(rawBody) as { leaseId?: unknown })
      : {};
    const leaseId =
      typeof parsed.leaseId === "string" ? parsed.leaseId.trim() : "";
    if (!leaseId) {
      throw new AgentLeaseError(
        "invalid_request",
        "leaseId is required to renew an MCP lease.",
      );
    }

    const lease = await renewAgentLease(store, verified.agent, leaseId);
    return Response.json(
      { lease },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    if (error instanceof AgentLeaseError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...error.details,
          },
        },
        { status: leaseErrorStatus(error.code) },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "MCP lease renewal is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}