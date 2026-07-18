import { getAgentAuditStore } from "@/lib/agent-audit";
import { privatePausedReason } from "@/lib/agent-policy";
import { AgentProvisioningError } from "@/lib/agent-provisioning";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import {
  executeRetirementRecovery,
  retryRetirementRecovery,
} from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { getUAClient, hasParticleEnv } from "@/lib/ua";
import { mockTradeSigners } from "@/lib/ua/mock";

/**
 * POST /api/agents/lifecycle/retirement/recover
 * Signer-authenticated recovery / retry. Completes conversion + transfer when
 * Particle is unset (mock path). With Particle configured, returns actionable
 * needs_attention until a live signed submit path is used — never claims the
 * backend can reconstruct the local signer.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/lifecycle/retirement/recover",
      store,
      nonceStore: getAgentNonceStore(),
    });

    const body = JSON.parse(rawBody || "{}") as {
      retirementId?: string;
      retry?: boolean;
    };

    if (hasParticleEnv()) {
      // Live Particle still requires CLI-held signatures for value-moving legs.
      // Authenticate the signer, surface retry state, and refuse to pretend the
      // server can move funds without those signatures.
      const retirementStore = getAgentRetirementStore();
      const retirement =
        (typeof body.retirementId === "string"
          ? await retirementStore.get(body.retirementId)
          : null) ?? (await retirementStore.getByAgentId(verified.agent.agentId));
      if (!retirement) {
        throw new AgentProvisioningError(
          "agent_not_found",
          "No retirement record exists for this agent.",
        );
      }
      return Response.json(
        {
          agent: verified.agent,
          retirement,
          recoveryRequired: retirement.reconciliationState !== "complete",
          privatePausedReason: privatePausedReason(verified.agent),
          signerNote:
            "Live Particle recovery requires CLI-held root-hash signatures from the original local signer. Conviction cannot reconstruct or replace that signer.",
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }

    const result =
      body.retry === true
        ? await retryRetirementRecovery({
            store,
            retirementStore: getAgentRetirementStore(),
            auditStore: getAgentAuditStore(),
            ownerUserId: verified.agent.ownerUserId,
            agentId: verified.agent.agentId,
            ua: getUAClient(verified.agent.address ?? undefined),
            signers: mockTradeSigners,
          })
        : await executeRetirementRecovery({
            store,
            retirementStore: getAgentRetirementStore(),
            auditStore: getAgentAuditStore(),
            agent: verified.agent,
            retirementId:
              typeof body.retirementId === "string" && body.retirementId
                ? body.retirementId
                : (
                    await getAgentRetirementStore().getByAgentId(
                      verified.agent.agentId,
                    )
                  )?.retirementId ?? "",
            ua: getUAClient(verified.agent.address ?? undefined),
            signers: mockTradeSigners,
          });

    if (!result.retirement) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement record exists for this agent.",
      );
    }

    return Response.json(
      {
        agent: result.agent,
        retirement: result.retirement,
        recoveryRequired:
          result.agent.status === "retiring" &&
          result.retirement.reconciliationState !== "complete",
        privatePausedReason: privatePausedReason(result.agent),
        signerNote:
          "Recovery used the authenticated local signer path. Conviction cannot reconstruct or replace that signer.",
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
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Request body must be JSON.",
          },
        },
        { status: 422 },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Retirement recovery is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
