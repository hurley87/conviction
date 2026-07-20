import {
  AgentApiBodyError,
  parseAgentJsonObject,
} from "@/lib/agent-api-body";
import { getAgentAuditStore } from "@/lib/agent-audit";
import {
  createBackWorkflowStarter,
  createConvictionBackAttributionApplier,
} from "@/lib/agent-back-attribution";
import { getAgentBackRecordStore } from "@/lib/agent-back-store";
import {
  AgentExecuteError,
  type AgentExecuteErrorBody,
} from "@/lib/agent-execute";
import {
  executeErrorStatus,
  submitSignedTradeExecution,
} from "@/lib/agent-permit";
import { createExecutionReconciler } from "@/lib/agent-execution-reconciliation";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import { createExecutionWorkflowStarter } from "@/lib/agent-execution-workflow";
import { createSignedTradeSender } from "@/lib/agent-permit-send";
import {
  getAgentExecuteIdempotencyStore,
  getAgentPermitStore,
  getAgentReceiptPersist,
  getAgentSpendLedger,
} from "@/lib/agent-permit-store";
import { commitAgentSpend } from "@/lib/agent-policy";
import {
  AgentRequestAuthError,
  agentAuthErrorStatus,
  getAgentNonceStore,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";
import { getPublicAgentProvisioningStore } from "@/lib/agent-provisioning-store";
import { getAgentQuoteStore } from "@/lib/agent-quote-store";
import { getAgentTradeReceiptStore } from "@/lib/agent-trade-receipt-store";
import { getUAClient } from "@/lib/ua";

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

    const now = new Date();
    const activeLease = await store.getActiveLease(
      verified.agent.agentId,
      now,
    );

    const permitStore = getAgentPermitStore();
    const spendLedger = getAgentSpendLedger();
    const executionFinalityStore = getExecutionFinalityStore();
    const result = await submitSignedTradeExecution({
      agent: verified.agent,
      input: {
        permitId: typeof body.permitId === "string" ? body.permitId : "",
        idempotencyKey:
          typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        leaseId: typeof body.leaseId === "string" ? body.leaseId : "",
        rootHashSignature:
          typeof body.rootHashSignature === "string"
            ? body.rootHashSignature
            : "",
        ...(authorizations ? { authorizations } : {}),
      },
      permitStore,
      idempotencyStore: getAgentExecuteIdempotencyStore(),
      receipts: getAgentReceiptPersist(),
      quoteStore: getAgentQuoteStore(),
      tradeReceipts: getAgentTradeReceiptStore(),
      backStore: getAgentBackRecordStore(),
      startBackWorkflow: createBackWorkflowStarter(),
      attributeBack: createConvictionBackAttributionApplier(),
      send: createSignedTradeSender(verified.agent.address),
      executionFinalityStore,
      executionWorkflow: createExecutionWorkflowStarter(),
      executionReconciler: createExecutionReconciler({
        store: executionFinalityStore,
        ua: getUAClient(verified.agent.address),
        now: () => now,
      }),
      workflowCorrelationId:
        request.headers.get("x-conviction-correlation-id") ?? null,
      activeLeaseId: activeLease?.leaseId ?? null,
      spendLedger,
      now: () => now,
      reloadAgent: async () => {
        const fresh = await store.findBySignerAddress(
          verified.agent.address!,
        );
        if (!fresh) {
          throw new AgentExecuteError(
            "unavailable",
            "Agent identity is no longer available.",
          );
        }
        return fresh;
      },
      onSpend: async (dollarsIn) => {
        const beforeSpend = await store.findBySignerAddress(
          verified.agent.address!,
        );
        await commitAgentSpend({
          store,
          auditStore: getAgentAuditStore(),
          permitStore,
          spendLedger,
          agentId: verified.agent.agentId,
          dollarsIn,
          previousStatus: beforeSpend?.status ?? verified.agent.status,
          now,
        });
      },
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
          message: "Signed trade submission is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
}
