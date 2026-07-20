import {
  AgentApiBodyError,
  parseAgentJsonObject,
} from "@/lib/agent-api-body";
import { loadAgentAccountStatus } from "@/lib/agent-account-status";
import {
  AgentExecuteError,
  type AgentExecuteErrorBody,
} from "@/lib/agent-execute";
import {
  executeErrorStatus,
  issueTradeExecutionPermit,
} from "@/lib/agent-permit";
import { createExecutionReconciler } from "@/lib/agent-execution-reconciliation";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { createExecutionWorkflowStarter } from "@/lib/agent-execution-workflow";
import {
  getAgentExecuteIdempotencyStore,
  getAgentPermitStore,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getUAClient } from "@/lib/ua";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const store = getPublicAgentProvisioningStore();
    const verified = await verifyAgentRequest({
      request,
      rawBody,
      path: "/api/agents/execute/permit",
      store,
      nonceStore: getAgentNonceStore(),
    });

    let body: Record<string, unknown>;
    try {
      body = parseAgentJsonObject(rawBody);
    } catch (error) {
      if (error instanceof AgentApiBodyError) {
        throw new AgentExecuteError("invalid_input", error.message);
      }
      throw error;
    }

    const quoteId = typeof body.quoteId === "string" ? body.quoteId : "";
    const idempotencyKey =
      typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    const leaseId = typeof body.leaseId === "string" ? body.leaseId : "";
    const expectedAction =
      body.expectedAction === "trade" || body.expectedAction === "back"
        ? body.expectedAction
        : undefined;

    const now = new Date();
    const activeLease = await store.getActiveLease(
      verified.agent.agentId,
      now,
    );
    const status = await loadAgentAccountStatus(verified.agent);
    const executionFinalityStore = getExecutionFinalityStore();

    const result = await issueTradeExecutionPermit({
      agent: verified.agent,
      quoteId,
      idempotencyKey,
      leaseId,
      activeLeaseId: activeLease?.leaseId ?? null,
      quoteStore: getAgentQuoteStore(),
      permitStore: getAgentPermitStore(),
      idempotencyStore: getAgentExecuteIdempotencyStore(),
      executionFinalityStore,
      executionWorkflow: createExecutionWorkflowStarter(),
      ...(verified.agent.address
        ? {
            executionReconciler: createExecutionReconciler({
              store: executionFinalityStore,
              ua: getUAClient(verified.agent.address),
              now: () => now,
            }),
          }
        : {}),
      balance: status.balance,
      spendLedger: getAgentSpendLedger(),
      ...(expectedAction ? { expectedAction } : {}),
      now: () => now,
    });

    if (!result.ok) {
      if (result.execution) {
        return Response.json(
          { result },
          {
            status: 200,
            headers: { "cache-control": "no-store" },
          },
        );
      }
      return Response.json(
        { error: result },
        {
          status: executeErrorStatus(result.code),
          headers: { "cache-control": "no-store" },
        },
      );
    }

    // Success may be a prior AgentExecuteSuccess (idempotent complete) or a permit.
    if ("permitId" in result) {
      return Response.json(
        { permit: result },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { result: { ...result, outcome: "finalized" as const } },
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
          message: "Execution permit issuance is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
