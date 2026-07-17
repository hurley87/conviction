import {
  agentAuthErrorResponse,
  authenticateAgentGet,
  unavailableResponse,
} from "@/lib/agent-api-route";
import { AGENT_SUMMARIZE_FEED_PATH } from "@/lib/agent-network-reads";
import { listConvictions } from "@/lib/convictions";
import { summarizeFeedDigest } from "@/lib/feed-summary-llm";
import { flagConvictions } from "@/lib/verbs/feed-summary";

export async function GET(request: Request) {
  try {
    await authenticateAgentGet({
      request,
      path: AGENT_SUMMARIZE_FEED_PATH,
    });

    const entries = await listConvictions();
    const flaggedEntries = flagConvictions(entries);
    const digest = await summarizeFeedDigest(entries, flaggedEntries);

    return Response.json(
      {
        ok: true,
        digest,
        flagged: flaggedEntries.map((entry) => entry.entryId),
        flaggedEntries: flaggedEntries.map((entry) => ({
          entryId: entry.entryId,
          handle: entry.handle,
          reason: entry.reason,
        })),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = agentAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return unavailableResponse("Feed summary is temporarily unavailable.");
  }
}
