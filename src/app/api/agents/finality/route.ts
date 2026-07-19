import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { loadOperatorFinalityStatus } from "@/lib/agent-operator-finality";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import { getAgentRetirementStore } from "@/lib/agent-retirement-store";
import { AgentProvisioningError } from "@/lib/agent-provisioning";

/** Authenticated operator evidence for owned execution and retirement finality. */
export async function GET(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const agent = await ctx.store.findNonRetiredByOwner(ctx.ownerUserId);
    const url = new URL(request.url);
    const executionId = url.searchParams.get("executionId")?.trim() || undefined;
    const retirementId =
      url.searchParams.get("retirementId")?.trim() || undefined;
    if (!agent) {
      if (executionId || retirementId) {
        throw new AgentProvisioningError(
          "agent_not_found",
          "No finality record matches that identity for this account.",
        );
      }
      return Response.json(
        { executions: [], retirement: null },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const status = await loadOperatorFinalityStatus({
      ownerUserId: ctx.ownerUserId,
      agentId: agent.agentId,
      executionStore: getExecutionFinalityStore(),
      retirementStore: getAgentRetirementStore(),
      quoteStore: getAgentQuoteStore(),
      ...(executionId ? { executionId } : {}),
      ...(retirementId ? { retirementId } : {}),
    });
    return Response.json(status, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
