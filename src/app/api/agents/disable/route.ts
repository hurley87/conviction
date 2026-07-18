import { disableAgent, privatePausedReason } from "@/lib/agent-policy";
import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";

/**
 * POST /api/agents/disable
 * Operator (Privy) reversible pause. Blocks new write permits immediately.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as {
      agentId?: string;
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

    const result = await disableAgent({
      store: ctx.store,
      auditStore: ctx.auditStore,
      permitStore: ctx.permitStore,
      spendLedger: ctx.spendLedger,
      ownerUserId: ctx.ownerUserId,
      agentId,
    });

    return Response.json(
      {
        agent: result.agent,
        releasedPermitCount: result.releasedPermitCount,
        privatePausedReason: privatePausedReason(result.agent),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
