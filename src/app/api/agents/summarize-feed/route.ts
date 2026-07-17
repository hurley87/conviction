import { runAgentGetRoute } from "@/lib/agent-api-route";
import { AGENT_SUMMARIZE_FEED_PATH } from "@/lib/agent-network-reads";
import { listConvictions } from "@/lib/convictions";
import { summarizeFeedDigest } from "@/lib/feed-summary-llm";
import { flagConvictions } from "@/lib/verbs/feed-summary";

export async function GET(request: Request) {
  return runAgentGetRoute({
    request,
    path: AGENT_SUMMARIZE_FEED_PATH,
    handler: async () => {
      const entries = await listConvictions();
      const flaggedEntries = flagConvictions(entries);
      const digest = await summarizeFeedDigest(entries, flaggedEntries);
      return {
        ok: true as const,
        digest,
        flagged: flaggedEntries.map((entry) => entry.entryId),
        flaggedEntries: flaggedEntries.map((entry) => ({
          entryId: entry.entryId,
          handle: entry.handle,
          reason: entry.reason,
        })),
      };
    },
    fallbackMessage: "Feed summary is temporarily unavailable.",
  });
}
