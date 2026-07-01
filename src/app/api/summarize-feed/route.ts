// Read-only feed summary API (issue #6). No trade execution.

import { listConvictions } from "@/lib/convictions";
import { summarizeFeedDigest } from "@/lib/feed-summary-llm";
import { flagConvictions } from "@/lib/verbs/feed-summary";

export async function GET() {
  const entries = await listConvictions();
  const flaggedEntries = flagConvictions(entries);
  const digest = await summarizeFeedDigest(entries, flaggedEntries);

  return Response.json({
    digest,
    flagged: flaggedEntries.map((f) => f.entryId),
    flaggedEntries,
  });
}
