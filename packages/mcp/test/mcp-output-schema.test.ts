import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  executeResultSchema,
  receiptGetResultSchema,
  structuredErrorResultSchema,
} from "../src/agent-reads-contract.js";
import {
  executeOutputSchema,
  mcpReadToolOutputSchema,
} from "../src/mcp-output-schema.js";

describe("mcpReadToolOutputSchema", () => {
  const successSchema = z.object({
    ok: z.literal(true),
    name: z.string(),
  });

  it("keeps Zod success validation strict", () => {
    const outputSchema = mcpReadToolOutputSchema(successSchema);

    expect(outputSchema.safeParse({ ok: true, name: "scout" }).success).toBe(
      true,
    );
    expect(outputSchema.safeParse({ ok: true }).success).toBe(false);
    expect(
      outputSchema.safeParse({
        ok: false,
        code: "not_found",
        message: "missing",
      }).success,
    ).toBe(false);
  });

  it("advertises oneOf success|structured error for MCP hosts", () => {
    const outputSchema = mcpReadToolOutputSchema(successSchema);
    const jsonSchema = z.toJSONSchema(outputSchema) as {
      type?: string;
      oneOf?: unknown[];
    };

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.oneOf).toHaveLength(2);

    expect(
      structuredErrorResultSchema.safeParse({
        ok: false,
        code: "lease_lost",
        message: "gone",
      }).success,
    ).toBe(true);
  });
});

const lifecycle = (outcome: string) => ({
  executionId: `execution-${outcome}`,
  quoteId: "quote-1",
  transactionId: "particle-1",
  outcome,
  settlementStatus:
    outcome === "failed" ? "released" : outcome === "finalized" ? "settled" : "held",
  attemptCount: 2,
  lastProviderStatus: outcome,
  lastError: outcome === "failed" ? "destination reverted" : null,
  workflow: { runId: "workflow-1", correlationId: "correlation-1" },
  recovery:
    outcome === "needs_attention"
      ? {
          summary: "Operator review required.",
          affectedLegIds: ["destination"],
          steps: ["Inspect confirmed legs.", "Do not re-sign or resubmit."],
        }
      : null,
  legs: [
    {
      legId: "source",
      kind: "source",
      chainId: 8453,
      chainName: "Base",
      required: true,
      status: outcome === "finalized" || outcome === "partial" ? "finalized" : outcome,
      confirmedHash:
        outcome === "finalized" || outcome === "partial" ? "0xconfirmed" : null,
      explorerUrl:
        outcome === "finalized" || outcome === "partial"
          ? "https://basescan.org/tx/0xconfirmed"
          : null,
      attemptCount: 2,
      lastProviderStatus: outcome,
      lastError: null,
      submittedAt: "2026-07-19T12:00:00.000Z",
      confirmedAt:
        outcome === "finalized" || outcome === "partial"
          ? "2026-07-19T12:01:00.000Z"
          : null,
    },
  ],
  evidence: [
    {
      observedAt: "2026-07-19T12:01:00.000Z",
      attempt: 2,
      providerStatus: outcome,
      normalizedStatus: outcome,
      legId: "source",
      error: null,
    },
  ],
});

describe("execution lifecycle output schemas", () => {
  it.each(["submitted", "pending", "partial", "failed", "needs_attention"] as const)(
    "accepts explicit %s non-success execute and receipt results",
    (outcome) => {
      const execution = lifecycle(outcome);
      expect(
        executeResultSchema.safeParse({
          ok: false,
          code: outcome,
          outcome,
          message: `Execution is ${outcome}.`,
          quoteId: "quote-1",
          execution,
        }).success,
      ).toBe(true);
      expect(
        receiptGetResultSchema.safeParse({
          ok: true,
          receiptId: `execution-${outcome}`,
          outcome,
          receipt: null,
          entryAt: null,
          execution,
        }).success,
      ).toBe(true);
    },
  );

  it("accepts finalized execute and receipt results with confirmed evidence", () => {
    const receipt = {
      slug: "receipt-1",
      summary: "Confirmed trade",
      dollarsIn: 20,
      dollarsOut: 19.8,
      feeUsd: 0.2,
      legs: [
        {
          chain: "Base",
          txHash: "0xconfirmed",
          explorerUrl: "https://basescan.org/tx/0xconfirmed",
        },
      ],
    };
    expect(
      executeResultSchema.safeParse({
        ok: true,
        outcome: "finalized",
        receiptId: "receipt-1",
        quoteId: "quote-1",
        quoteFingerprint: "fingerprint-1",
        transactionId: "particle-1",
        summary: receipt.summary,
        receipt,
        dollarsIn: 20,
        dollarsOut: 19.8,
        feeUsd: 0.2,
        idempotencyKey: "idem-1",
      }).success,
    ).toBe(true);
    expect(
      receiptGetResultSchema.safeParse({
        ok: true,
        receiptId: "receipt-1",
        outcome: "finalized",
        receipt,
        entryAt: "2026-07-19T12:01:00.000Z",
        execution: lifecycle("finalized"),
      }).success,
    ).toBe(true);
  });

  it("accepts provider-finalized lifecycle while receipt settlement is pending", () => {
    const execution = {
      ...lifecycle("finalized"),
      settlementStatus: "persisting",
    };
    expect(
      executeResultSchema.safeParse({
        ok: false,
        code: "finalized",
        outcome: "finalized",
        message: "Confirmed execution is awaiting receipt settlement.",
        quoteId: "quote-1",
        execution,
      }).success,
    ).toBe(true);
    expect(
      receiptGetResultSchema.safeParse({
        ok: true,
        receiptId: "execution-finalized",
        outcome: "finalized",
        receipt: null,
        entryAt: null,
        execution,
      }).success,
    ).toBe(true);
  });

  it("advertises finalized and lifecycle execute variants to MCP hosts", () => {
    const jsonSchema = z.toJSONSchema(executeOutputSchema) as {
      type?: string;
      oneOf?: unknown[];
    };
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.oneOf).toBeDefined();
  });

  it("rejects mismatched lifecycle discrimination and unconfirmed hash evidence", () => {
    const pending = lifecycle("pending");
    expect(
      executeResultSchema.safeParse({
        ok: false,
        code: "partial",
        outcome: "pending",
        message: "mismatch",
        quoteId: "quote-1",
        execution: pending,
      }).success,
    ).toBe(false);
    expect(
      receiptGetResultSchema.safeParse({
        ok: true,
        receiptId: "execution-pending",
        outcome: "pending",
        receipt: null,
        entryAt: null,
        execution: {
          ...pending,
          legs: [
            {
              ...pending.legs[0],
              confirmedHash: "0xplanned-userop",
              explorerUrl: "https://example.test/tx/0xplanned-userop",
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
