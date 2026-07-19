// Submit a locally signed Particle transaction for an issued execution permit.
// Uses the stored quote payload — never silently requotes (ADR 0040).

import { createParticleAccount } from "@/lib/ua/particle";
import { hasParticleEnv } from "@/lib/ua";
import { assertTradeDebitWithinCeiling } from "@/lib/verbs/quote";
import type { SignedTradeSender } from "@/lib/agent-permit";
import type { RawTransaction } from "@/lib/ua/trade";
import { userOpsNeeding7702 } from "@/lib/ua/trade";

function particleEnvOrNull(): {
  projectId: string;
  projectClientKey: string;
  projectAppUuid: string;
} | null {
  const projectId = process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
  const projectClientKey = process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
  const projectAppUuid = process.env.NEXT_PUBLIC_PARTICLE_APP_ID;
  if (!projectId || !projectClientKey || !projectAppUuid) return null;
  return { projectId, projectClientKey, projectAppUuid };
}

export type CreateSignedTradeSenderOptions = {
  /**
   * Allow the deterministic MockUAClient path when Particle env is absent.
   * Production routes must leave this false so misconfiguration fails closed.
   */
  allowMock?: boolean;
};

/**
 * Build a SignedTradeSender for the agent owner.
 * Live Particle when configured. Without Particle, fails closed unless
 * `allowMock` is explicitly enabled for tests.
 */
export function createSignedTradeSender(
  ownerAddress: string,
  options: CreateSignedTradeSenderOptions = {},
): SignedTradeSender {
  return async (input) => {
    const raw = input.rawTransaction;
    if (!raw?.rootHash) {
      throw new Error("Permit raw transaction is missing rootHash.");
    }
    assertTradeDebitWithinCeiling(
      raw.tokenChanges ?? {},
      input.agreedQuote.dollarsIn,
    );

    const env = particleEnvOrNull();
    if (env && hasParticleEnv()) {
      const account = await createParticleAccount({
        ownerAddress,
        ...env,
      });
      const result = await account.sendTransaction(
        raw,
        input.rootHashSignature,
        input.authorizations,
      );
      const transactionId =
        result.transactionId ??
        raw.transactionId ??
        input.agreedQuote.transactionId;
      return { transactionId };
    }

    if (!options.allowMock) {
      throw new Error(
        "Particle is not configured; refusing to mock a value-moving submit.",
      );
    }

    // Explicit test-only path — still requires signature shape, then mock-sends.
    if (!input.rootHashSignature.startsWith("0x")) {
      throw new Error("Invalid rootHash signature.");
    }
    const pending7702 = userOpsNeeding7702(raw.userOps);
    if (
      pending7702.length > 0 &&
      (!input.authorizations ||
        input.authorizations.length < pending7702.length)
    ) {
      throw new Error("Missing EIP-7702 authorizations for pending userOps.");
    }

    return {
      transactionId:
        raw.transactionId ?? input.agreedQuote.transactionId,
    };
  };
}

/** Expose raw helper for tests that need to assert no requote. */
export function assertStoredRawTransaction(
  raw: RawTransaction | null | undefined,
): asserts raw is RawTransaction {
  if (!raw || typeof raw !== "object" || !raw.rootHash) {
    throw new Error("Stored quote rawTransaction is missing or incomplete.");
  }
}
