import {
  agentAuthErrorResponse,
  authenticateAgentGet,
  notFoundResponse,
  unavailableResponse,
} from "@/lib/agent-api-route";
import {
  agentConvictionPath,
  toConvictionAttribution,
} from "@/lib/agent-network-reads";
import { getConviction } from "@/lib/convictions";

type RouteContext = {
  params: Promise<{ entryId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { entryId: rawEntryId } = await context.params;
  const entryId = decodeURIComponent(rawEntryId ?? "").trim();
  if (!entryId) {
    return notFoundResponse("Conviction not found.");
  }

  const path = agentConvictionPath(entryId);

  try {
    await authenticateAgentGet({ request, path });
    const entry = await getConviction(entryId);
    if (!entry) {
      return notFoundResponse("Conviction not found.");
    }
    return Response.json(
      {
        ok: true,
        entry,
        attribution: toConvictionAttribution(entry),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = agentAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return unavailableResponse("Conviction lookup is temporarily unavailable.");
  }
}
