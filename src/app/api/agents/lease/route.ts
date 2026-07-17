import {
  AgentLeaseError,
  acquireAgentLease,
  leaseErrorStatus,
  releaseAgentLease,
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
      path: "/api/agents/lease",
      store,
      nonceStore: getAgentNonceStore(),
    });

    let replace = false;
    if (rawBody.trim()) {
      const parsed = JSON.parse(rawBody) as { replace?: unknown };
      replace = parsed.replace === true;
    }

    const lease = await acquireAgentLease(store, verified.agent, { replace });
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
          message: "MCP lease acquisition is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/lease",
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
        "leaseId is required to release an MCP lease.",
      );
    }

    await releaseAgentLease(store, verified.agent, leaseId);
    return Response.json(
      { ok: true },
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
          message: "MCP lease release is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
