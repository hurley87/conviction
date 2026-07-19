import { z } from "zod";

export const MOCK_ACCOUNT_STATUS = {
  ok: true,
  mode: "mock",
  status: "ready",
  funded: false,
  signingAvailable: false,
  agent: {
    handle: "mock-conviction-agent",
    address: null,
  },
} as const;

export const MOCK_INTERACTION_SUCCESS = {
  ok: true,
  mode: "mock",
  code: "mock_success",
  message: "Conviction MCP mock interaction completed.",
  interactionId: "mock-interaction-001",
} as const;

export const MOCK_INTERACTION_ERROR = {
  ok: false,
  mode: "mock",
  code: "mock_error",
  message: "Deterministic mock error requested.",
  interactionId: "mock-interaction-001",
} as const;

export const MOCK_INTERACTION_SCENARIOS = ["success", "error"] as const;

const mockLifecycle = {
  quoteId: "mock-quote-finality",
  transactionId: "mock-particle-transaction",
  settlementStatus: "held",
  attemptCount: 2,
  workflow: {
    runId: "mock-workflow-finality",
    correlationId: "mock-correlation-finality",
  },
  evidence: [
    {
      observedAt: "2026-07-19T12:01:00.000Z",
      attempt: 2,
      providerStatus: "processing",
      normalizedStatus: "pending",
      legId: "destination",
      error: null,
    },
  ],
} as const;

/** Read-only host fixtures; no signer, provider, network, or real funds. */
export const MOCK_FINALITY_RECEIPT_FIXTURES = {
  "mock-execution-pending": {
    ok: true,
    mode: "mock",
    receiptId: "mock-execution-pending",
    outcome: "pending",
    receipt: null,
    entryAt: null,
    execution: {
      ...mockLifecycle,
      executionId: "mock-execution-pending",
      outcome: "pending",
      lastProviderStatus: "processing",
      lastError: null,
      recovery: null,
      legs: [
        {
          legId: "destination",
          kind: "destination",
          chainId: 42161,
          chainName: "Arbitrum",
          required: true,
          status: "pending",
          confirmedHash: null,
          explorerUrl: null,
          attemptCount: 2,
          lastProviderStatus: "processing",
          lastError: null,
          submittedAt: "2026-07-19T12:00:00.000Z",
          confirmedAt: null,
        },
      ],
    },
  },
  "mock-execution-partial": {
    ok: true,
    mode: "mock",
    receiptId: "mock-execution-partial",
    outcome: "partial",
    receipt: null,
    entryAt: null,
    execution: {
      ...mockLifecycle,
      executionId: "mock-execution-partial",
      outcome: "partial",
      lastProviderStatus: "destination_failed",
      lastError: "The destination leg did not finalize.",
      recovery: {
        summary: "Operator review is required for the failed destination leg.",
        affectedLegIds: ["destination"],
        steps: [
          "Inspect the confirmed source leg and failed destination leg.",
          "Do not re-sign or resubmit this execution.",
        ],
      },
      legs: [
        {
          legId: "source",
          kind: "source",
          chainId: 8453,
          chainName: "Base",
          required: true,
          status: "finalized",
          confirmedHash: "0xmockconfirmedsource",
          explorerUrl:
            "https://basescan.org/tx/0xmockconfirmedsource",
          attemptCount: 1,
          lastProviderStatus: "confirmed",
          lastError: null,
          submittedAt: "2026-07-19T12:00:00.000Z",
          confirmedAt: "2026-07-19T12:00:30.000Z",
        },
        {
          legId: "destination",
          kind: "destination",
          chainId: 42161,
          chainName: "Arbitrum",
          required: true,
          status: "failed",
          confirmedHash: null,
          explorerUrl: null,
          attemptCount: 2,
          lastProviderStatus: "failed",
          lastError: "Destination reverted.",
          submittedAt: "2026-07-19T12:00:00.000Z",
          confirmedAt: null,
        },
      ],
    },
  },
} as const;

export type MockAccountStatus = typeof MOCK_ACCOUNT_STATUS;
export type MockInteractionSuccess = typeof MOCK_INTERACTION_SUCCESS;
export type MockInteractionError = typeof MOCK_INTERACTION_ERROR;
export type MockInteractionResult = MockInteractionSuccess | MockInteractionError;
export type MockInteractionScenario = (typeof MOCK_INTERACTION_SCENARIOS)[number];

export const mockAccountStatusOutputSchema = {
  ok: z.literal(MOCK_ACCOUNT_STATUS.ok),
  mode: z.literal(MOCK_ACCOUNT_STATUS.mode),
  status: z.literal(MOCK_ACCOUNT_STATUS.status),
  funded: z.literal(MOCK_ACCOUNT_STATUS.funded),
  signingAvailable: z.literal(MOCK_ACCOUNT_STATUS.signingAvailable),
  agent: z.object({
    handle: z.literal(MOCK_ACCOUNT_STATUS.agent.handle),
    address: z.null(),
  }),
};

export const mockInteractionInputSchema = {
  scenario: z.enum(MOCK_INTERACTION_SCENARIOS).default("success"),
};

export const mockInteractionOutputSchema = {
  ok: z.boolean(),
  mode: z.literal(MOCK_INTERACTION_SUCCESS.mode),
  code: z.enum([MOCK_INTERACTION_SUCCESS.code, MOCK_INTERACTION_ERROR.code]),
  message: z.string(),
  interactionId: z.literal(MOCK_INTERACTION_SUCCESS.interactionId),
};

/** Pure deterministic mock account payload. */
export function accountStatusResult(): MockAccountStatus {
  return MOCK_ACCOUNT_STATUS;
}

/** Pure deterministic mock interaction payload. */
export function mockInteractionResult(
  scenario: MockInteractionScenario = "success",
): MockInteractionResult {
  switch (scenario) {
    case "success":
      return MOCK_INTERACTION_SUCCESS;
    case "error":
      return MOCK_INTERACTION_ERROR;
    default: {
      const _exhaustive: never = scenario;
      throw new Error(`unsupported mock scenario: ${_exhaustive}`);
    }
  }
}
