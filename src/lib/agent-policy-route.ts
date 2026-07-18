import { AgentProvisioningError } from "@/lib/agent-provisioning";
import {
  authenticateRequest,
  RequestAuthenticationError,
} from "@/lib/server-auth";
import { getProvisioningContext } from "@/lib/agent-provisioning-store";
import { getAgentAuditStore } from "@/lib/agent-audit";
import {
  getAgentPermitStore,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import type { AgentProvisioningStore } from "@/lib/agent-provisioning";
import type { AgentAuditStore } from "@/lib/agent-audit";
import type { AgentPermitStore, AgentSpendLedger } from "@/lib/agent-permit";

export function operatorPolicyErrorResponse(error: unknown): Response {
  if (error instanceof RequestAuthenticationError) {
    return Response.json(
      { error: { code: "unauthenticated", message: error.message } },
      { status: error.status },
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
        message: "Agent Settings is temporarily unavailable. Try again shortly.",
      },
    },
    { status: 503 },
  );
}

export type OperatorPolicyContext = {
  store: AgentProvisioningStore;
  auditStore: AgentAuditStore;
  permitStore: AgentPermitStore;
  spendLedger: AgentSpendLedger;
  ownerUserId: string;
};

/** Privy-authenticated operator context for Agent Settings mutations. */
export async function getOperatorPolicyContext(
  request: Request,
): Promise<OperatorPolicyContext> {
  const auth = await authenticateRequest(request);
  const { store } = await getProvisioningContext(auth.userId, auth.mock);
  return {
    store,
    auditStore: getAgentAuditStore(),
    permitStore: getAgentPermitStore(),
    spendLedger: getAgentSpendLedger(),
    ownerUserId: auth.userId,
  };
}
