import {
  notFoundResponse,
  runAgentGetRoute,
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

  return runAgentGetRoute({
    request,
    path: agentConvictionPath(entryId),
    handler: async () => {
      const entry = await getConviction(entryId);
      if (!entry) {
        throw new ConvictionNotFoundError();
      }
      return {
        ok: true as const,
        entry,
        attribution: toConvictionAttribution(entry),
      };
    },
    onError: (error) => {
      if (error instanceof ConvictionNotFoundError) {
        return notFoundResponse("Conviction not found.");
      }
      return null;
    },
    fallbackMessage: "Conviction lookup is temporarily unavailable.",
  });
}

class ConvictionNotFoundError extends Error {
  constructor() {
    super("Conviction not found.");
    this.name = "ConvictionNotFoundError";
  }
}
