import { describe, expect, it } from "vitest";

import {
  createExecutionFinalityRecord,
  type ExecutionFinalityRecord,
} from "@/lib/agent-execution-finality";
import { toAgentExecutionLifecycle } from "@/lib/agent-execution-public";

function record(): ExecutionFinalityRecord {
  const created = createExecutionFinalityRecord({
    executionId: "execution-1",
    agentId: "agent-1",
    permitId: "permit-1",
    quoteId: "quote-1",
    idempotencyKey: "idem-1",
    particleTransactionId: "particle-1",
    createdAt: "2026-07-19T12:00:00.000Z",
    legs: [
      {
        legId: "source",
        kind: "source",
        chainId: 8453,
        chainName: "Base",
        required: true,
        status: "pending",
        confirmedHash: "0xplanned-userop",
        attemptCount: 1,
        lastProviderStatus: "processing",
        lastError: null,
        submittedAt: "2026-07-19T12:00:00.000Z",
        confirmedAt: null,
        updatedAt: "2026-07-19T12:00:00.000Z",
        providerEvidence: [],
      },
    ],
    providerEvidence: [
      {
        observedAt: "2026-07-19T12:00:01.000Z",
        attempt: 1,
        providerStatus: "processing",
        normalizedStatus: "pending",
        legId: "source",
        transactionId: "particle-1",
        confirmedHash: "0xplanned-userop",
        error: null,
        raw: {
          signature: "0xsecret",
          userOps: [{ userOpHash: "0xplanned-userop" }],
        },
      },
    ],
  });
  return {
    ...created,
    outcome: "pending",
    attemptCount: 1,
    lastProviderStatus: "processing",
  };
}

describe("toAgentExecutionLifecycle", () => {
  it("removes raw provider data and never promotes an unconfirmed hash", () => {
    const projected = toAgentExecutionLifecycle(record());

    expect(projected.outcome).toBe("pending");
    expect(projected.legs[0]).toMatchObject({
      status: "pending",
      confirmedHash: null,
      explorerUrl: null,
    });
    expect(projected.evidence[0]).toEqual({
      observedAt: "2026-07-19T12:00:01.000Z",
      attempt: 1,
      providerStatus: "processing",
      normalizedStatus: "pending",
      legId: "source",
      error: null,
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /raw|signature|userOps|0xplanned-userop/,
    );
  });
});
