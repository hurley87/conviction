// Shared response helpers for session-authenticated agent provisioning routes.

import { privatePausedReason } from "@/lib/agent-policy";
import {
  AgentProvisioningError,
  provisioningErrorStatus,
  type OwnedAgent,
} from "@/lib/agent-provisioning";
import { RequestAuthenticationError } from "@/lib/server-auth";

/** Shape an owned agent for the client (derived budget + paused reason). */
export function agentPayload(agent: OwnedAgent) {
  const remainingBudgetUsd = Math.max(
    0,
    agent.spendBudgetUsd - agent.lifetimeSpendUsd,
  );
  return {
    ...agent,
    remainingBudgetUsd,
    privatePausedReason: privatePausedReason(agent),
  };
}

/** Map auth / provisioning-domain errors to a JSON response (503 fallback). */
export function provisioningRouteError(error: unknown): Response {
  if (error instanceof RequestAuthenticationError) {
    return Response.json(
      { error: { code: "unauthenticated", message: error.message } },
      { status: error.status },
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
        message: "Agent Access is temporarily unavailable. Try again shortly.",
      },
    },
    { status: 503 },
  );
}
