import "server-only";

import { PrivyClient, type VerifyAccessTokenResponse } from "@privy-io/node";

export class ChatAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "ChatAuthError";
  }
}

type VerifyToken = (token: string) => Promise<VerifyAccessTokenResponse>;

let client: PrivyClient | null = null;

function getVerifier(): VerifyToken {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new ChatAuthError("Chat authentication is not configured.", 503);
  }
  client ??= new PrivyClient({
    appId,
    appSecret,
    jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
  });
  return (token) => client!.utils().auth().verifyAccessToken(token);
}

export async function requirePrivyUserId(
  request: Request,
  verifyToken?: VerifyToken,
) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new ChatAuthError("A Privy bearer token is required.", 401);
  }
  try {
    const claims = await (verifyToken ?? getVerifier())(match[1]);
    if (!claims.user_id) throw new Error("missing user id");
    return claims.user_id;
  } catch (error) {
    if (error instanceof ChatAuthError) throw error;
    throw new ChatAuthError("The Privy bearer token is invalid.", 401);
  }
}

export function resetChatAuthClientForTests() {
  client = null;
}
