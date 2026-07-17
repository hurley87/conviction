import {
  invalidRequestResponse,
  notFoundResponse,
  runAgentGetRoute,
} from "@/lib/agent-api-route";
import { agentReceiptPath } from "@/lib/agent-network-reads";
import { getStoredReceiptRecord } from "@/lib/receipts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const receiptId = url.searchParams.get("receiptId")?.trim();
  if (!receiptId) {
    return invalidRequestResponse("receiptId is required.");
  }

  return runAgentGetRoute({
    request,
    path: agentReceiptPath(receiptId),
    handler: async () => {
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
