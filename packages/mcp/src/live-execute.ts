// Live conviction_execute_trade orchestration (issue #56 / ADR 0020 / 0045).
// Permit before signing; local ethers signer; fail closed if backend is down.

import { ConvictionApiError } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import { createLocalTradeSigners } from "./local-trade-signers.js";
import {
  requestExecutionPermit,
  submitSignedExecution,
  type LiveExecuteResult,
  type LiveExecutionPermit,
} from "./live-api-client.js";
import { userOpsNeeding7702 } from "./raw-transaction.js";
import { toolResult } from "./tool-result.js";

export type LiveExecuteToolResult = ReturnType<typeof toolResult>;

function unavailable(message: string): LiveExecuteToolResult {
  return toolResult(
    {
      ok: false,
      code: "unavailable",
      message,
    },
    true,
  );
}

function fromApiError(error: unknown, fallback: string): LiveExecuteToolResult {
  if (error instanceof ConvictionApiError) {
    return toolResult(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.details.fields ? { fields: error.details.fields } : {}),
      },
      true,
    );
  }
  return unavailable(error instanceof Error ? error.message : fallback);
}

/**
 * Obtain a live permit, sign with the local Particle-compatible signer, and
 * submit. Never silently requotes. Backend unavailability fails before signing.
 */
export async function executeLiveTrade(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  leaseId: string;
  quoteId: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}): Promise<LiveExecuteToolResult> {
  const quoteId = options.quoteId.trim();
  const idempotencyKey = options.idempotencyKey.trim();
  if (!quoteId) {
    return toolResult(
      {
        ok: false,
        code: "invalid_input",
        message: "Provide the quoteId returned by conviction_quote_trade.",
        fields: [
          {
            field: "quoteId",
            code: "required",
            message: "Provide the quoteId returned by conviction_quote_trade.",
          },
        ],
      },
      true,
    );
  }
  if (!idempotencyKey) {
    return toolResult(
      {
        ok: false,
        code: "invalid_input",
        message: "Provide a durable idempotencyKey for this execution.",
        fields: [
          {
            field: "idempotencyKey",
            code: "required",
            message: "Provide a durable idempotencyKey for this execution.",
          },
        ],
      },
      true,
    );
  }

  let permitOrResult: LiveExecutionPermit | LiveExecuteResult;
  try {
    permitOrResult = await requestExecutionPermit({
      apiBaseUrl: options.apiBaseUrl,
      wallet: options.wallet,
      quoteId,
      idempotencyKey,
      leaseId: options.leaseId,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  } catch (error) {
    // ADR 0020: fail closed before any local signing when backend is unreachable.
    return fromApiError(
      error,
      "Could not obtain an execution permit. Value-moving tools fail closed while the backend is unavailable.",
    );
  }

  // Idempotent complete result returned from the permit endpoint.
  if ("receiptId" in permitOrResult && permitOrResult.ok) {
    return toolResult({
      ...permitOrResult,
      mode: "live",
    });
  }
  if ("ok" in permitOrResult && permitOrResult.ok === false) {
    return toolResult(permitOrResult, true);
  }

  const permit = permitOrResult as LiveExecutionPermit;
  const raw = permit.rawTransaction as {
    rootHash?: string;
    userOps?: Array<{
      chainId: number;
      userOpHash?: string;
      userOp?: {
        eip7702Auth?: { chainId: number; nonce: number; address: string };
        eip7702Delegated?: boolean;
      };
      eip7702Auth?: { chainId: number; nonce: number; address: string };
      eip7702Delegated?: boolean;
    }>;
  };

  if (!raw?.rootHash) {
    return unavailable(
      "Execution permit is missing a signable rootHash. Call conviction_quote_trade again.",
    );
  }

  // Sign only after a live permit is in hand (ADR 0020 / 0045).
  const signers = createLocalTradeSigners(options.wallet);
  let rootHashSignature: string;
  const authorizations: Array<{ userOpHash: string; signature: string }> = [];
  try {
    rootHashSignature = await signers.signRootHash(raw.rootHash);
    for (const pending of userOpsNeeding7702(raw.userOps)) {
      const signature = await signers.sign7702(pending.auth);
      authorizations.push({
        userOpHash: pending.userOpHash,
        signature,
      });
    }
  } catch (error) {
    return unavailable(
      error instanceof Error
        ? `Local signer failed: ${error.message}`
        : "Local signer failed before submission.",
    );
  }

  try {
    const result = await submitSignedExecution({
      apiBaseUrl: options.apiBaseUrl,
      wallet: options.wallet,
      permitId: permit.permitId,
      idempotencyKey,
      rootHashSignature,
      ...(authorizations.length > 0 ? { authorizations } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    if (!result.ok) {
      return toolResult(result, true);
    }
    return toolResult({
      ...result,
      mode: "live",
    });
  } catch (error) {
    return fromApiError(
      error,
      "Signed submission failed. If the result is uncertain, do not resign — wait for reconciliation.",
    );
  }
}
