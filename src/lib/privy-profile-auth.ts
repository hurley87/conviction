import "server-only";

import {
  PrivyClient,
  type User,
  type VerifyAccessTokenResponse,
} from "@privy-io/node";
import type { IdentitySource } from "@/lib/identity";

export type VerifiedPrivyIdentity = {
  privyId: string;
  email: string | null;
  identitySource: IdentitySource;
  providerHandle: string | null;
};

export class PrivyProfileAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 503,
  ) {
    super(message);
    this.name = "PrivyProfileAuthError";
  }
}

let client: PrivyClient | null = null;

type VerifyToken = (token: string) => Promise<VerifyAccessTokenResponse>;

function getPrivyClient() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new PrivyProfileAuthError(
      "Profile authentication is not configured.",
      503,
    );
  }
  client ??= new PrivyClient({
    appId,
    appSecret,
    jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
  });
  return client;
}

async function requirePrivyUserId(
  request: Request,
  verifyToken: VerifyToken = (token) =>
    getPrivyClient().utils().auth().verifyAccessToken(token),
) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new PrivyProfileAuthError("A Privy bearer token is required.", 401);
  }
  try {
    const claims = await verifyToken(match[1]);
    if (!claims.user_id) throw new Error("missing user id");
    return claims.user_id;
  } catch (error) {
    if (error instanceof PrivyProfileAuthError) throw error;
    throw new PrivyProfileAuthError(
      "The Privy bearer token is invalid.",
      401,
    );
  }
}

export function identityFromPrivyUser(user: User): VerifiedPrivyIdentity {
  const twitter = user.linked_accounts.find(
    (account) => account.type === "twitter_oauth",
  );
  const email = user.linked_accounts.find(
    (account) => account.type === "email",
  );

  if (twitter?.type === "twitter_oauth" && twitter.username) {
    return {
      privyId: user.id,
      email: email?.type === "email" ? email.address : null,
      identitySource: "twitter",
      providerHandle: twitter.username,
    };
  }
  if (email?.type === "email") {
    return {
      privyId: user.id,
      email: email.address,
      identitySource: "email",
      providerHandle: null,
    };
  }
  throw new PrivyProfileAuthError(
    "A verified email or X account is required.",
    401,
  );
}

export async function getAuthenticatedPrivyIdentity(request: Request) {
  const privyId = await requirePrivyUserId(request);

  try {
    const user = await getPrivyClient().users()._get(privyId);
    if (user.id !== privyId) {
      throw new Error("Privy returned a different user");
    }
    return identityFromPrivyUser(user);
  } catch (error) {
    if (error instanceof PrivyProfileAuthError) throw error;
    throw new PrivyProfileAuthError(
      "The verified Privy profile could not be loaded.",
      503,
    );
  }
}

export function resetPrivyProfileClientForTests() {
  client = null;
}
