import {
  getOperatorPolicyContext,
  operatorPolicyErrorResponse,
} from "@/lib/agent-policy-route";
import { getAgentNotificationStore } from "@/lib/agent-notifications";

/** POST /api/agents/notifications/read — marks an owned notification as read. */
export async function POST(request: Request) {
  try {
    const ctx = await getOperatorPolicyContext(request);
    const body = (await request.json().catch(() => null)) as {
      notificationId?: string;
    } | null;
    const notificationId =
      typeof body?.notificationId === "string" ? body.notificationId.trim() : "";
    if (!notificationId) {
      return Response.json(
        { error: { code: "invalid_request", message: "notificationId is required." } },
        { status: 422 },
      );
    }
    const notification = await getAgentNotificationStore().markRead(
      notificationId,
      ctx.ownerUserId,
    );
    if (!notification) {
      return Response.json(
        { error: { code: "notification_not_found", message: "Notification not found." } },
        { status: 404 },
      );
    }
    return Response.json(
      { notification },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return operatorPolicyErrorResponse(error);
  }
}
