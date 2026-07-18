import { privatePausedReason } from "@/lib/agent-policy";
import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import { reconcileRetirementResiduals } from "@/lib/agent-retirement";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { getUAClient } from "@/lib/ua";
import { AgentProvisioningError } from "@/lib/agent-provisioning";

/**
 * POST /api/agents/retirement/retry
 * Operator-only residual reconciliation retry (no signing). Value-moving
 * recovery retries remain on the signer-authenticated CLI path.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as {
      agentId?: string;
      retirementId?: string;
    } | null;
    const agentId =
      typeof body?.agentId === "string" ? body.agentId.trim() : "";
    if (!agentId) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "agentId is required.",
          },
        },
        { status: 422 },
      );
    }

    const agent = await ctx.store.findNonRetiredByOwner(ctx.ownerUserId);
    if (!agent || agent.agentId !== agentId) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No agent matches that identity for this account.",
      );
    }
    if (agent.status !== "retiring" && agent.status !== "retired") {
      throw new AgentProvisioningError(
        "lifecycle_blocked",
        `Agent @${agent.handle} is not in a retirement retry state.`,
      );
    }

    const retirementStore = getAgentRetirementStore();
    const retirement =
      (typeof body?.retirementId === "string"
        ? await retirementStore.get(body.retirementId)
        : null) ?? (await retirementStore.getByAgentId(agent.agentId));
    if (
      !retirement ||
      retirement.agentId !== agent.agentId ||
      retirement.ownerUserId !== agent.ownerUserId
    ) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No retirement record exists for this agent.",
      );
    }

    if (retirement.reconciliationState === "needs_attention") {
      await retirementStore.casReconciliationState({
        retirementId: retirement.retirementId,
        from: "needs_attention",
        to: "pending_sync",
        lastError: null,
      });
    }

    const updated = await reconcileRetirementResiduals({
      store: ctx.store,
      retirementStore,
      auditStore: ctx.auditStore,
      retirementId: retirement.retirementId,
      ua: getUAClient(agent.address ?? undefined),
    });

    const refreshed =
      (await ctx.store.findNonRetiredByOwner(ctx.ownerUserId)) ?? agent;

    return Response.json(
      {
        agent:
          updated.reconciliationState === "complete" &&
          refreshed.agentId === agent.agentId &&
          refreshed.status !== "retired"
            ? {
                ...refreshed,
                status: "retired" as const,
                publicStatus: "retired" as const,
                retiredAt: updated.completedAt,
              }
            : refreshed.status === "retired" ||
                updated.reconciliationState === "complete"
              ? {
                  ...agent,
                  status: "retired" as const,
                  publicStatus: "retired" as const,
                  retiredAt: updated.completedAt ?? agent.retiredAt,
                }
              : refreshed,
        retirement: updated,
        recoveryRequired: updated.reconciliationState !== "complete",
        privatePausedReason: privatePausedReason(
          updated.reconciliationState === "complete"
            ? {
                ...agent,
                status: "retired",
                publicStatus: "retired",
              }
            : refreshed,
        ),
        signerNote:
          updated.reconciliationState === "complete"
            ? null
            : "Value-moving recovery retries require conviction-mcp retire with the original local signer. Conviction cannot reconstruct or replace it.",
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
