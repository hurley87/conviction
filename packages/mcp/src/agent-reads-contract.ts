/**
 * Shared MCP↔web wire contract for read tools (issue #53).
 * Paths, Zod schemas, and inferred types live here so signed-request
 * path strings and tool payloads cannot drift between packages.
 */
import { z } from "zod";

export const DEFAULT_CONVICTION_PAGE_LIMIT = 20;
export const MAX_CONVICTION_PAGE_LIMIT = 50;
export const COMPACT_THESIS_MAX_CHARS = 280;

export const AGENT_SUMMARIZE_FEED_PATH = "/api/agents/summarize-feed";

/** Canonical signed path for paginated conviction listing. */
export function agentConvictionsListPath(query: {
  limit?: number;
  cursor?: string;
}): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  const qs = params.toString();
  return qs ? `/api/agents/convictions?${qs}` : "/api/agents/convictions";
}

export function agentConvictionPath(entryId: string): string {
  return `/api/agents/convictions/${encodeURIComponent(entryId)}`;
}

export function agentReceiptPath(receiptId: string): string {
  return `/api/agents/receipts?${new URLSearchParams({ receiptId }).toString()}`;
}

export const universalBalanceSchema = z.object({
  totalUsd: z.number(),
  sources: z.array(
    z.object({
      chain: z.string(),
      asset: z.string(),
      usd: z.number(),
    }),
  ),
});

export const depositAddressesSchema = z.object({
  evm: z.string(),
  solana: z.string().nullable(),
});

export const actionPolicySchema = z.object({
  trade: z.boolean(),
  back: z.boolean(),
  publish: z.boolean(),
});

export const accountStatusResultSchema = z.object({
  ok: z.literal(true),
  mode: z.literal("live"),
  agentId: z.string(),
  handle: z.string(),
  operatorHandle: z.string(),
  address: z.string(),
  depositAddress: z.string(),
  depositAddresses: depositAddressesSchema,
  balance: universalBalanceSchema,
  status: z.string(),
  publicStatus: z.string(),
  actionPolicy: actionPolicySchema,
  maxTradeUsd: z.number(),
  spendBudgetUsd: z.number(),
  lifetimeSpendUsd: z.number(),
  remainingBudgetUsd: z.number(),
  fundingReady: z.boolean(),
  setupVerifiedAt: z.string().nullable(),
});

const authorshipSnapshotSchema = z.object({
  agentId: z.string(),
  authorKind: z.literal("agent"),
  handle: z.string(),
  operatorHandle: z.string(),
});

export const compactConvictionSchema = z.object({
  entryId: z.string(),
  handle: z.string(),
  thesis: z.string(),
  trade: z.object({
    fromAsset: z.string(),
    toAsset: z.string(),
    sizeUsd: z.number(),
    toChain: z.string(),
    tokenSymbol: z.string().optional(),
  }),
  createdAt: z.string(),
  backerCount: z.number(),
  receiptSlug: z.string().optional(),
  authorship: authorshipSnapshotSchema.optional(),
  anatomy: z.object({
    whyNowCount: z.number(),
    hasWhatBreaksIt: z.boolean(),
    gatePassed: z.number(),
    gateFailed: z.number(),
  }),
});

export const backerAttributionSchema = z.object({
  handle: z.string(),
  authorKind: z.literal("agent").optional(),
  operatorHandle: z.string().optional(),
  agentId: z.string().optional(),
});

export const convictionAttributionSchema = z.object({
  backerCount: z.number(),
  backedBy: z.array(z.string()),
  /** Rich attribution with agent disclosure + authorship snapshot (issue #58). */
  backers: z.array(backerAttributionSchema).optional(),
});

const tokenRefSchema = z.object({
  chainId: z.number(),
  address: z.string(),
  symbol: z.string(),
});

const convictionTradeSchema = z.object({
  fromAsset: z.string(),
  fromChain: z.string(),
  toAsset: z.string(),
  token: tokenRefSchema.optional(),
  toChain: z.string(),
  sizeUsd: z.number(),
});

const whyNowEventSchema = z.object({
  at: z.string(),
  event: z.string(),
});

const gateCheckSchema = z.object({
  id: z.enum(["liquidity", "contract", "routability"]).optional(),
  name: z.string(),
  passed: z.boolean(),
  detail: z.string().optional(),
  evidenceUrl: z.string().optional(),
});

/** Full canonical conviction — get returns this; list returns CompactConviction. */
export const convictionEntrySchema = z.object({
  entryId: z.string(),
  handle: z.string(),
  thesis: z.string(),
  trade: convictionTradeSchema,
  createdAt: z.string(),
  backedBy: z.array(z.string()),
  receiptSlug: z.string().optional(),
  whyNow: z.array(whyNowEventSchema).optional(),
  whatBreaksIt: z.string().optional(),
  gateReport: z.array(gateCheckSchema).optional(),
  authorship: authorshipSnapshotSchema.optional(),
});

export const convictionListResultSchema = z.object({
  ok: z.literal(true),
  entries: z.array(compactConvictionSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const convictionGetResultSchema = z.object({
  ok: z.literal(true),
  entry: convictionEntrySchema,
  attribution: convictionAttributionSchema,
});

export const flaggedConvictionSchema = z.object({
  entryId: z.string(),
  handle: z.string(),
  reason: z.string(),
});

export const feedSummaryResultSchema = z.object({
  ok: z.literal(true),
  digest: z.string(),
  flagged: z.array(z.string()),
  flaggedEntries: z.array(flaggedConvictionSchema),
});

export const receiptLegSchema = z.object({
  chain: z.string(),
  txHash: z.string(),
  explorerUrl: z.string(),
});

export const executionOutcomeSchema = z.enum([
  "submitted",
  "pending",
  "finalized",
  "partial",
  "failed",
  "needs_attention",
]);

export const executionLegStatusSchema = z.enum([
  "submitted",
  "pending",
  "finalized",
  "failed",
  "needs_attention",
]);

export const executionLifecycleSchema = z.object({
  executionId: z.string(),
  quoteId: z.string(),
  transactionId: z.string().nullable(),
  outcome: executionOutcomeSchema,
  settlementStatus: z.enum([
    "held",
    "accounting",
    "persisting",
    "settled",
    "released",
    "needs_attention",
  ]),
  attemptCount: z.number().int().nonnegative(),
  lastProviderStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  workflow: z.object({
    runId: z.string().nullable(),
    correlationId: z.string().nullable(),
  }),
  recovery: z
    .object({
      summary: z.string(),
      affectedLegIds: z.array(z.string()),
      steps: z.array(z.string()),
    })
    .nullable(),
  legs: z.array(
    z.object({
      legId: z.string(),
      kind: z.string(),
      chainId: z.number().int().positive(),
      chainName: z.string(),
      required: z.boolean(),
      status: executionLegStatusSchema,
      confirmedHash: z.string().nullable(),
      explorerUrl: z.string().nullable(),
      attemptCount: z.number().int().nonnegative(),
      lastProviderStatus: z.string().nullable(),
      lastError: z.string().nullable(),
      submittedAt: z.string().nullable(),
      confirmedAt: z.string().nullable(),
    }),
  ),
  evidence: z.array(
    z.object({
      observedAt: z.string(),
      attempt: z.number().int().nonnegative(),
      providerStatus: z.string().nullable(),
      normalizedStatus: executionOutcomeSchema.nullable(),
      legId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
}).superRefine((execution, context) => {
  for (const [index, leg] of execution.legs.entries()) {
    if (
      leg.status !== "finalized" &&
      (leg.confirmedHash !== null || leg.explorerUrl !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["legs", index, "confirmedHash"],
        message:
          "Only finalized legs may expose confirmed hashes or explorer links.",
      });
    }
  }
});

export const receiptSchema = z.object({
  slug: z.string(),
  summary: z.string(),
  dollarsIn: z.number(),
  dollarsOut: z.number(),
  feeUsd: z.number(),
  legs: z.array(receiptLegSchema),
});

export const receiptGetResultSchema = z.object({
  ok: z.literal(true),
  receiptId: z.string(),
  outcome: executionOutcomeSchema,
  receipt: receiptSchema.nullable(),
  entryAt: z.string().nullable(),
  execution: executionLifecycleSchema.nullable(),
}).superRefine((result, context) => {
  if (result.execution && result.execution.outcome !== result.outcome) {
    context.addIssue({
      code: "custom",
      path: ["execution", "outcome"],
      message: "Receipt and execution outcomes must match.",
    });
  }
  if (result.outcome === "finalized") {
    const hasReceipt = result.receipt !== null && result.entryAt !== null;
    const awaitingSettlement =
      result.receipt === null &&
      result.entryAt === null &&
      result.execution !== null &&
      result.execution.settlementStatus !== "settled";
    if (!hasReceipt && !awaitingSettlement) {
      context.addIssue({
        code: "custom",
        path: ["receipt"],
        message:
          "Finalized lookup requires receipt evidence or an execution still awaiting settlement.",
      });
    }
  }
  if (
    result.outcome !== "finalized" &&
    (result.receipt !== null ||
      result.entryAt !== null ||
      result.execution === null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["receipt"],
      message:
        "Non-finalized receipt lookup must return lifecycle evidence without a receipt.",
    });
  }
});

export const executeFinalizedResultSchema = z.object({
  ok: z.literal(true),
  outcome: z.literal("finalized"),
  receiptId: z.string(),
  quoteId: z.string(),
  quoteFingerprint: z.string(),
  transactionId: z.string(),
  summary: z.string(),
  receipt: receiptSchema,
  dollarsIn: z.number(),
  dollarsOut: z.number(),
  feeUsd: z.number(),
  idempotencyKey: z.string(),
  action: z.enum(["trade", "back"]).optional(),
  entryId: z.string().optional(),
  backRecordId: z.string().optional(),
  reconciliationState: z
    .enum(["complete", "pending_sync", "needs_attention"])
    .optional(),
  code: z.literal("executed_pending_sync").optional(),
});

export const executeLifecycleResultSchema = z.object({
  ok: z.literal(false),
  code: executionOutcomeSchema,
  outcome: executionOutcomeSchema,
  message: z.string(),
  action: z.enum(["trade", "back"]).optional(),
  quoteId: z.string(),
  execution: executionLifecycleSchema,
}).superRefine((result, context) => {
  if (
    result.code !== result.outcome ||
    result.execution.outcome !== result.outcome
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Execute lifecycle code, outcome, and execution must match.",
    });
  }
});

export const executeResultSchema = z.discriminatedUnion("ok", [
  executeFinalizedResultSchema,
  executeLifecycleResultSchema,
]);

/** Shared structured error payload returned by live read tools (`isError: true`). */
export const structuredErrorResultSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
});

export type UniversalBalance = z.infer<typeof universalBalanceSchema>;
export type DepositAddresses = z.infer<typeof depositAddressesSchema>;
export type AccountStatusResult = z.infer<typeof accountStatusResultSchema>;
export type CompactConviction = z.infer<typeof compactConvictionSchema>;
export type ConvictionAttribution = z.infer<typeof convictionAttributionSchema>;
export type ConvictionEntryWire = z.infer<typeof convictionEntrySchema>;
export type ConvictionListResult = z.infer<typeof convictionListResultSchema>;
export type ConvictionGetResult = z.infer<typeof convictionGetResultSchema>;
export type FeedSummaryResult = z.infer<typeof feedSummaryResultSchema>;
export type ReceiptGetResult = z.infer<typeof receiptGetResultSchema>;
export type ExecutionLifecycle = z.infer<typeof executionLifecycleSchema>;
export type ExecuteResult = z.infer<typeof executeResultSchema>;
export type StructuredErrorResult = z.infer<typeof structuredErrorResultSchema>;
