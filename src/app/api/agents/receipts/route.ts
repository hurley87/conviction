import {
  invalidRequestResponse,
  notFoundResponse,
  runAgentGetRoute,
} from "@/lib/agent-api-route";
import { agentReceiptPath } from "@/lib/agent-network-reads";
import { getStoredReceiptRecord } from "@/lib/receipts";
import { getExecutionFinalityStore } from "@/lib/agent-execution-finality-store";

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
      const execution = await getExecutionFinalityStore().get(receiptId);
      if (execution) {
        if (execution.agentId !== agent.agentId) {
          throw new ReceiptNotFoundError();
        }
        if (!execution.settlementResult) {
          return {
            ok: false as const,
            receiptId,
            execution: {
              executionId: execution.executionId,
              transactionId: execution.particleTransactionId,
              outcome: execution.outcome,
              settlementStatus: execution.settlementStatus,
              lastProviderStatus: execution.lastProviderStatus,
              lastError: execution.lastError ?? execution.settlementError,
              legs: execution.legs.map((leg) => ({
                legId: leg.legId,
                kind: leg.kind,
                chainId: leg.chainId,
                chainName: leg.chainName,
                required: leg.required,
                status: leg.status,
                confirmedHash: leg.confirmedHash,
                lastProviderStatus: leg.lastProviderStatus,
                lastError: leg.lastError,
              })),
            },
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
        receipt: record.receipt,
        entryAt: record.entryAt,
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
