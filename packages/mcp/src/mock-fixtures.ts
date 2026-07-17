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
