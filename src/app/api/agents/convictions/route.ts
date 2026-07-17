import {
  agentAuthErrorResponse,
  authenticateAgentGet,
  invalidRequestResponse,
  unavailableResponse,
} from "@/lib/agent-api-route";
import { agentConvictionsListPath } from "@/lib/agent-network-reads";
import {
  ConvictionReadError,
  listConvictionsPage,
} from "@/lib/convictions";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;

  let limit: number | undefined;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      return invalidRequestResponse("limit must be a positive integer.");
    }
    limit = parsed;
  }

  const path = agentConvictionsListPath({
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor ? { cursor } : {}),
  });

  try {
    await authenticateAgentGet({ request, path });
    const page = await listConvictionsPage({
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return Response.json(
      {
        ok: true,
        entries: page.entries,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = agentAuthErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ConvictionReadError) {
      return invalidRequestResponse(error.message);
    }
    return unavailableResponse("Conviction listing is temporarily unavailable.");
  }
}
