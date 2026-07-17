import {
  agentAuthErrorResponse,
  authenticateAgentGet,
  invalidRequestResponse,
  notFoundResponse,
  unavailableResponse,
} from "@/lib/agent-api-route";
import { agentReceiptPath } from "@/lib/agent-network-reads";
import { getStoredReceiptRecord } from "@/lib/receipts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const receiptId = url.searchParams.get("receiptId")?.trim();
  if (!receiptId) {
    return invalidRequestResponse("receiptId is required.");
  }

  const path = agentReceiptPath(receiptId);

  try {
    await authenticateAgentGet({ request, path });
    const record = await getStoredReceiptRecord(receiptId);
    if (!record) {
      return notFoundResponse("Receipt not found.");
    }
    return Response.json(
      {
        ok: true,
        receiptId,
        receipt: record.receipt,
        entryAt: record.entryAt,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const authResponse = agentAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return unavailableResponse("Receipt lookup is temporarily unavailable.");
  }
}
