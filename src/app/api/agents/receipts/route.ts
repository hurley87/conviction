import {
  invalidRequestResponse,
  notFoundResponse,
  runAgentGetRoute,
} from "@/lib/agent-api-route";
import { agentReceiptPath } from "@/lib/agent-network-reads";
import { getStoredReceiptRecord } from "@/lib/receipts";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";
import {
  toAgentExecutionLifecycle,
} from "@/lib/agent-execution-public";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const receiptId = url.searchParams.get("receiptId")?.trim();
  if (!receiptId) {
    return invalidRequestResponse("receiptId is required.");
  }

  return runAgentGetRoute({
    request,
    path: agentReceiptPath(receiptId),
    handler: async (agent) => {
      const finalityStore = getExecutionFinalityStore();
      const directExecution = await finalityStore.get(receiptId);
      const execution =
        directExecution ??
        (await finalityStore.getByReceiptId(agent.agentId, receiptId));
      if (execution) {
        if (execution.agentId !== agent.agentId) {
          throw new ReceiptNotFoundError();
        }
        if (!execution.settlementResult) {
          return {
            ok: true as const,
            receiptId,
            outcome: execution.outcome,
            receipt: null,
            entryAt: null,
            execution: toAgentExecutionLifecycle(execution),
          };
        }
      }
      const record = await getStoredReceiptRecord(receiptId);
      if (!record) {
        throw new ReceiptNotFoundError();
      }
      return {
        ok: true as const,
        receiptId,
        outcome: "finalized" as const,
        receipt: record.receipt,
        entryAt: record.entryAt,
        execution: execution
          ? toAgentExecutionLifecycle(execution)
          : null,
      };
    },
    onError: (error) => {
      if (error instanceof ReceiptNotFoundError) {
        return notFoundResponse("Receipt not found.");
      }
      return null;
    },
    fallbackMessage: "Receipt lookup is temporarily unavailable.",
  });
}

class ReceiptNotFoundError extends Error {
  constructor() {
    super("Receipt not found.");
    this.name = "ReceiptNotFoundError";
  }
}
