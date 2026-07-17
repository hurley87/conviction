// Shared helpers for authenticated agent API routes.

import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import type { OwnedAgent } from "@/lib/agent-provisioning";

export async function authenticateAgentGet(options: {
  request: Request;
  path: string;
}): Promise<OwnedAgent> {
  const store = getPublicAgentProvisioningStore();
  const verified = await verifyAgentRequest({
    request: options.request,
    rawBody: "",
    path: options.path,
    store,
    nonceStore: getAgentNonceStore(),
  });
  return verified.agent;
}

export function agentAuthErrorResponse(error: unknown): Response | null {
  if (error instanceof AgentRequestAuthError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: agentAuthErrorStatus(error.code) },
    );
  }
  return null;
}

export function unavailableResponse(message: string): Response {
  return Response.json(
    { error: { code: "unavailable", message } },
    { status: 503 },
  );
}

export function notFoundResponse(message: string): Response {
  return Response.json(
    { error: { code: "not_found", message } },
    { status: 404 },
  );
}

export function invalidRequestResponse(message: string): Response {
  return Response.json(
    { error: { code: "invalid_request", message } },
    { status: 400 },
  );
}
