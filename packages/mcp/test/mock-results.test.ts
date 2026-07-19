import { describe, expect, it } from "vitest";

import {
  MOCK_ACCOUNT_STATUS,
  MOCK_INTERACTION_ERROR,
  MOCK_INTERACTION_SUCCESS,
  MOCK_FINALITY_RECEIPT_FIXTURES,
  accountStatusResult,
  mockInteractionResult,
} from "../src/mock-fixtures.js";
import { toolResult } from "../src/tool-result.js";

describe("mock result builders", () => {
  it("returns the shared account-status fixture", () => {
    expect(accountStatusResult()).toEqual(MOCK_ACCOUNT_STATUS);
    expect(accountStatusResult()).toBe(MOCK_ACCOUNT_STATUS);
  });

  it("returns the same structured success for repeated interactions", () => {
    const first = mockInteractionResult("success");
    const second = mockInteractionResult("success");

    expect(first).toEqual(MOCK_INTERACTION_SUCCESS);
    expect(second).toEqual(first);
    expect(toolResult(first).isError).toBeUndefined();
  });

  it("returns a stable structured mock error", () => {
    const result = mockInteractionResult("error");

    expect(result).toEqual(MOCK_INTERACTION_ERROR);
    expect(toolResult(result, !result.ok)).toMatchObject({
      isError: true,
      structuredContent: MOCK_INTERACTION_ERROR,
    });
  });

  it("provides deterministic pending and partial lifecycle fixtures", () => {
    expect(MOCK_FINALITY_RECEIPT_FIXTURES["mock-execution-pending"]).toMatchObject({
      outcome: "pending",
      receipt: null,
      execution: { legs: [{ status: "pending", confirmedHash: null }] },
    });
    expect(MOCK_FINALITY_RECEIPT_FIXTURES["mock-execution-partial"]).toMatchObject({
      outcome: "partial",
      receipt: null,
      execution: {
        legs: [
          { status: "finalized", confirmedHash: "0xmockconfirmedsource" },
          { status: "failed", confirmedHash: null },
        ],
      },
    });
  });
});
