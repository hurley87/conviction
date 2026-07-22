import {
  agentPayload,
  provisioningRouteError,
} from "@/lib/agent-provisioning-api";
import { regenerateProvisioningHandoff } from "@/lib/agent-provisioning";
import { getProvisioningContext } from "@/lib/agent-provisioning-store";
import { resolvePublicAppOrigin } from "@/lib/public-app-origin";
import { authenticateRequest } from "@/lib/server-auth";

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    const { store, owner } = await getProvisioningContext(
      auth.userId,
      auth.mock,
    );
    const result = await regenerateProvisioningHandoff(store, owner, {
      apiBaseUrl: resolvePublicAppOrigin(request),
    });
    return Response.json(
      {
        ...result,
        agent: agentPayload(result.agent),
      },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return provisioningRouteError(error);
  }
}
