import "server-only";
import { PrivyClient } from "@privy-io/node";

export type AuthenticatedUser = { userId: string; mock: boolean };

export class RequestAuthenticationError extends Error {
  constructor(
    public readonly status: 401 | 503,
    message: string,
  ) {
    super(message);
    this.name = "RequestAuthenticationError";
  }
}

let privyClient: PrivyClient | null = null;

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedUser> {
  const token = bearerToken(request);
  if (!token) {
    throw new RequestAuthenticationError(
      401,
      "Sign in to Conviction before creating an agent.",
    );
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    if (process.env.NODE_ENV !== "production" && token === "mock-local-user") {
      return { userId: "mock-local-user", mock: true };
    }
    throw new RequestAuthenticationError(
      503,
      "Agent authentication is not configured.",
    );
  }

  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appSecret) {
    throw new RequestAuthenticationError(
      503,
      "Agent authentication is not configured.",
    );
  }

  privyClient ??= new PrivyClient({
    appId,
    appSecret,
    jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
  });

  try {
    const claims = await privyClient.utils().auth().verifyAccessToken(token);
    return { userId: claims.user_id, mock: false };
  } catch {
    throw new RequestAuthenticationError(
      401,
      "Your session expired. Sign in again and retry.",
    );
  }
}
