import {
  AgentApiBodyError,
  parseAgentJsonObject,
} from "@/lib/agent-api-body";
import {
  AgentExecuteError,
  type AgentExecuteErrorBody,
} from "@/lib/agent-execute";
import {
  executeErrorStatus,
  submitSignedTradeExecution,
} from "@/lib/agent-permit";
import { createSignedTradeSender } from "@/lib/agent-permit-send";
import {
  getAgentExecuteIdempotencyStore,
  getAgentPermitStore,
  getAgentReceiptPersist,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/execute/submit",
      store,
      nonceStore: getAgentNonceStore(),
    });

    if (!verified.agent.address) {
      throw new AgentExecuteError(
        "unavailable",
        "Agent signer address is not bound; cannot submit a signed trade.",
      );
    }

    let body: Record<string, unknown>;
    try {
      body = parseAgentJsonObject(rawBody);
    } catch (error) {
      if (error instanceof AgentApiBodyError) {
        throw new AgentExecuteError("invalid_input", error.message);
      }
      throw error;
    }

    const authorizations = Array.isArray(body.authorizations)
      ? body.authorizations.filter(
          (
            entry,
          ): entry is { userOpHash: string; signature: string } =>
            !!entry &&
            typeof entry === "object" &&
            typeof (entry as { userOpHash?: unknown }).userOpHash ===
              "string" &&
            typeof (entry as { signature?: unknown }).signature === "string",
        )
      : undefined;

    const result = await submitSignedTradeExecution({
      agent: verified.agent,
      input: {
        permitId: typeof body.permitId === "string" ? body.permitId : "",
        idempotencyKey:
          typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        rootHashSignature:
          typeof body.rootHashSignature === "string"
            ? body.rootHashSignature
            : "",
        ...(authorizations ? { authorizations } : {}),
      },
      permitStore: getAgentPermitStore(),
      idempotencyStore: getAgentExecuteIdempotencyStore(),
      receipts: getAgentReceiptPersist(),
      send: createSignedTradeSender(verified.agent.address),
      spendLedger: getAgentSpendLedger(),
      onSpend: async (dollarsIn) => {
        await store.addLifetimeSpend({
          agentId: verified.agent.agentId,
          dollarsIn,
        });
      },
    });

    if (!result.ok) {
      return Response.json(
        { error: result },
        {
          status: executeErrorStatus(result.code),
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
    if (error instanceof AgentExecuteError) {
      const body: AgentExecuteErrorBody = error.toBody();
      return Response.json(
        { error: body },
        {
          status: executeErrorStatus(body.code),
          headers: { "cache-control": "no-store" },
        },
      );
    }
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "Signed trade submission is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
