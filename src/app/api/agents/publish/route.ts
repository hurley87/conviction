import {
  AgentApiBodyError,
  parseAgentJsonObject,
} from "@/lib/agent-api-body";
import {
  AgentPublishError,
  publishAgentConviction,
  publishErrorStatus,
  type AgentPublishErrorBody,
} from "@/lib/agent-publish";
import {
  getConviction,
  getConvictionByReceiptSlug,
  saveConviction,
} from "@/lib/convictions";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getAgentTradeReceiptStore } from "@/lib/agent-trade-receipt-store";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/publish",
      store,
      nonceStore: getAgentNonceStore(),
    });

    let body: Record<string, unknown>;
    try {
      body = parseAgentJsonObject(rawBody);
    } catch (error) {
      if (error instanceof AgentApiBodyError) {
        throw new AgentPublishError("invalid_input", error.message);
      }
      throw error;
    }

    const result = await publishAgentConviction({
      agent: verified.agent,
      body,
      tradeReceipts: getAgentTradeReceiptStore(),
      convictions: {
        save: async (entry) => {
          await saveConviction(entry);
        },
        get: getConviction,
        getByReceiptSlug: getConvictionByReceiptSlug,
      },
      // Matches issueTradeQuote default — product primaries are gated offline;
      // long-tail targets are not direct MCP trade inputs in v1 (ADR 0031).
      checkRouter: async () => ({ status: "routable" }),
    });

    if (!result.ok) {
      return Response.json(
        { error: result },
        {
          status: publishErrorStatus(result.code),
          headers: { "cache-control": "no-store" },
        },
      );
    }

    return Response.json(
      { result },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AgentRequestAuthError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: agentAuthErrorStatus(error.code) },
      );
    }
    if (error instanceof AgentPublishError) {
      const body: AgentPublishErrorBody = error.toBody();
      return Response.json(
        { error: body },
        {
          status: publishErrorStatus(body.code),
          headers: { "cache-control": "no-store" },
        },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Conviction publication is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
