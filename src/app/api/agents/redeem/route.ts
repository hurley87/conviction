import {
  AgentProvisioningError,
  redeemPendingAgent,
} from "@/lib/agent-provisioning";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";

function errorStatus(code: AgentProvisioningError["code"]): number {
  switch (code) {
    case "handoff_not_found":
      return 404;
    case "handoff_expired":
    case "handoff_used":
    case "agent_not_pending":
    case "address_mismatch":
      return 409;
    case "invalid_proof":
    case "invalid_request":
      return 422;
    default:
      return 503;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const store = getPublicAgentProvisioningStore();
    const agent = await redeemPendingAgent(store, body);
    return Response.json(
      { agent },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentProvisioningError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: errorStatus(error.code) },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Provisioning redeem is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
