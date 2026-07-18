import {
  AgentApiBodyError,
  parseAgentJsonObject,
} from "@/lib/agent-api-body";
import { issueBackQuote } from "@/lib/agent-back";
import {
  AgentQuoteError,
  quoteErrorStatus,
} from "@/lib/agent-quote";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getConviction } from "@/lib/convictions";
import { getUAClient } from "@/lib/ua";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/quote/back",
      store,
      nonceStore: getAgentNonceStore(),
    });

    let body: Record<string, unknown>;
    try {
      body = parseAgentJsonObject(rawBody);
    } catch (error) {
      if (error instanceof AgentApiBodyError) {
        throw new AgentQuoteError("invalid_input", error.message);
      }
      throw error;
    }

    const quote = await issueBackQuote({
      store: getAgentQuoteStore(),
      ua: getUAClient(verified.agent.address ?? undefined),
      agent: verified.agent,
      body,
      convictions: { get: getConviction },
    });

    return Response.json(
      { quote },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    if (error instanceof AgentQuoteError) {
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details.fields ? { fields: error.details.fields } : {}),
            ...(error.details.preview ? { preview: error.details.preview } : {}),
          },
        },
        { status: quoteErrorStatus(error.code) },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Back quoting is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
