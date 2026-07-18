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
  assertRetirementOwnership,
  canUseMockRetirementRecovery,
  executeRetirementRecovery,
  finalizeRetirementRecovery,
  prepareRetirementRecovery,
  retryRetirementRecovery,
  submitRetirementLeg,
  type RetirementPrepareResult,
  type RetirementRecoveryResult,
} from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { getUAClient, hasParticleEnv } from "@/lib/ua";
import { mockTradeSigners } from "@/lib/ua/mock";

type RecoverBody = {
  retirementId?: string;
  retry?: boolean;
  action?: "prepare" | "submit" | "finalize" | "recover";
  legId?: string;
  rootHashSignature?: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
};

function jsonResult(
  result: RetirementRecoveryResult | RetirementPrepareResult,
  extra?: { signable?: RetirementPrepareResult["signable"] },
) {
  return Response.json(
    {
      agent: result.agent,
      retirement: result.retirement,
      recoveryRequired:
        result.agent.status === "retiring" &&
        result.retirement.reconciliationState !== "complete",
      privatePausedReason: privatePausedReason(result.agent),
      signerNote:
        "Recovery uses the original local signer only. Conviction cannot reconstruct or replace it.",
      ...(extra?.signable !== undefined ? { signable: extra.signable } : {}),
      ...("signable" in result ? { signable: result.signable } : {}),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

/**
 * POST /api/agents/lifecycle/retirement/recover
 * Signer-authenticated recovery.
 * - Mock/local: action=recover (default) runs in-process with mock signers.
 * - Live Particle: prepare → submit (with signatures) → finalize.
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

    const body = JSON.parse(rawBody || "{}") as RecoverBody;
    const retirementStore = getAgentRetirementStore();
    const retirementId =
      typeof body.retirementId === "string" && body.retirementId
        ? body.retirementId
        : (await retirementStore.getByAgentId(verified.agent.agentId))
            ?.retirementId;
    if (!retirementId) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement record exists for this agent.",
      );
    }

    // IDOR guard: retirementId must belong to the authenticated agent.
    const owned = await retirementStore.get(retirementId);
    if (!owned) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement record exists for this agent.",
      );
    }
    assertRetirementOwnership(owned, verified.agent);

    const action = body.action ?? (body.retry === true ? "recover" : "recover");
    const ua = getUAClient(verified.agent.address ?? undefined);
    const auditStore = getAgentAuditStore();

    if (hasParticleEnv()) {
      if (action === "prepare" || action === "recover") {
        const prepared = await prepareRetirementRecovery({
          store,
          retirementStore,
          auditStore,
          agent: verified.agent,
          retirementId,
          ua,
        });
        if (prepared.signable) {
          return jsonResult(prepared);
        }
        const finalized = await finalizeRetirementRecovery({
          store,
          retirementStore,
          auditStore,
          agent: verified.agent,
          retirementId,
          ua,
        });
        return jsonResult(finalized, { signable: null });
      }

      if (action === "submit") {
        if (typeof body.legId !== "string" || !body.legId) {
          throw new AgentProvisioningError(
            "invalid_request",
            "legId is required for retirement submit.",
          );
        }
        if (
          typeof body.rootHashSignature !== "string" ||
          !body.rootHashSignature
        ) {
          throw new AgentProvisioningError(
            "invalid_request",
            "rootHashSignature is required for retirement submit.",
          );
        }
        const submitted = await submitRetirementLeg({
          store,
          retirementStore,
          auditStore,
          agent: verified.agent,
          retirementId,
          legId: body.legId,
          rootHashSignature: body.rootHashSignature,
          ...(Array.isArray(body.authorizations)
            ? { authorizations: body.authorizations }
            : {}),
        });
        return jsonResult(submitted);
      }

      if (action === "finalize") {
        const finalized = await finalizeRetirementRecovery({
          store,
          retirementStore,
          auditStore,
          agent: verified.agent,
          retirementId,
          ua,
        });
        return jsonResult(finalized, { signable: null });
      }

      throw new AgentProvisioningError(
        "invalid_request",
        `Unsupported retirement recovery action: ${action}`,
      );
    }

    if (!canUseMockRetirementRecovery()) {
      throw new AgentProvisioningError(
        "setup_not_ready",
        "Retirement recovery is not configured. Set Particle env for live recovery.",
      );
    }

    const result =
      body.retry === true
        ? await retryRetirementRecovery({
            store,
            retirementStore,
            auditStore,
            ownerUserId: verified.agent.ownerUserId,
            agentId: verified.agent.agentId,
            retirementId,
            ua,
            signers: mockTradeSigners,
          })
        : await executeRetirementRecovery({
            store,
            retirementStore,
            auditStore,
            agent: verified.agent,
            retirementId,
            ua,
            signers: mockTradeSigners,
          });

    return jsonResult(result);
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
            : error.code === "setup_not_ready"
              ? 503
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
