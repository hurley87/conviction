import {
  AgentProvisioningError,
  createPendingAgent,
} from "@/lib/agent-provisioning";
import { getProvisioningContext } from "@/lib/agent-provisioning-store";
import {
  authenticateRequest,
  RequestAuthenticationError,
} from "@/lib/server-auth";

function errorResponse(error: unknown) {
  if (error instanceof RequestAuthenticationError) {
    return Response.json(
      { error: { code: "unauthenticated", message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof AgentProvisioningError) {
    const status = error.code === "agent_exists" ? 409 : 422;
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status },
    );
  }
  return Response.json(
    {
      error: {
        code: "unavailable",
        message: "Agent Access is temporarily unavailable. Try again shortly.",
      },
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    const { store } = await getProvisioningContext(auth.userId, auth.mock);
    const agent = await store.findNonRetiredByOwner(auth.userId);
    return Response.json({ agent });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    const body = await request.json().catch(() => null);
    const { store, owner } = await getProvisioningContext(
      auth.userId,
      auth.mock,
    );
    const result = await createPendingAgent(store, owner, body);
    return Response.json(result, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
