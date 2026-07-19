import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import {
  AgentProvisioningError,
} from "@/lib/agent-provisioning";
import {
  reconcileBackAttribution,
} from "@/lib/agent-back";
import { createConvictionBackAttributionApplier } from "@/lib/agent-back-attribution";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";

/** POST /api/agents/back/retry — operator retry for non-signing attribution. */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as {
      agentId?: string;
      backRecordId?: string;
    } | null;
    const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
    const backRecordId =
      typeof body?.backRecordId === "string" ? body.backRecordId.trim() : "";
    if (!agentId) {
      return Response.json(
        { error: { code: "invalid_request", message: "agentId is required." } },
        { status: 422 },
      );
    }
    const agent = await ctx.store.findNonRetiredByOwner(ctx.ownerUserId);
    if (!agent || agent.agentId !== agentId) {
      throw new AgentProvisioningError("agent_not_found", "No agent matches that identity for this account.");
    }
    const backStore = getAgentBackRecordStore();
    const record = backRecordId
      ? await backStore.get(backRecordId)
      : await backStore.getByAgentId(agent.agentId);
    if (
      !record ||
      record.agentId !== agent.agentId ||
      record.ownerUserId !== ctx.ownerUserId
    ) {
      throw new AgentProvisioningError("agent_not_found", "No back record exists for this agent.");
    }
    if (record.reconciliationState === "needs_attention") {
      await backStore.casReconciliationState({
        backRecordId: record.backRecordId,
        from: "needs_attention",
        to: "pending_sync",
        lastError: null,
      });
    }
    const updated = await reconcileBackAttribution({
      backRecordId: record.backRecordId,
      backStore,
      attribute: createConvictionBackAttributionApplier(),
    });
    return Response.json({ back: updated }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
