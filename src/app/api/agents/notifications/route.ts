import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import { getAgentNotificationStore } from "@/lib/agent-notifications";

/** GET /api/agents/notifications — recent notifications for the signed-in operator. */
export async function GET(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "20");
    const notifications = await getAgentNotificationStore().listByOwner(
      ctx.ownerUserId,
      Number.isFinite(limit) ? limit : 20,
    );
    return Response.json(
      { notifications },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
