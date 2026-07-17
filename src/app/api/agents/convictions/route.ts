import {
  invalidRequestResponse,
  runAgentGetRoute,
} from "@/lib/agent-api-route";
import {
  agentConvictionsListPath,
  toCompactConviction,
} from "@/lib/agent-network-reads";
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

  return runAgentGetRoute({
    request,
    path,
    handler: async () => {
      const page = await listConvictionsPage({
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      });
      return {
        ok: true as const,
        entries: page.entries.map(toCompactConviction),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      };
    },
    onError: (error) => {
      if (error instanceof ConvictionReadError) {
        return invalidRequestResponse(error.message);
      }
      return null;
    },
    fallbackMessage: "Conviction listing is temporarily unavailable.",
  });
}
