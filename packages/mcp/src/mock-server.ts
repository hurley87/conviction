import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  mockInteractionInputSchema,
  mockInteractionOutputSchema,
  mockInteractionResult,
  type MockInteractionScenario,
} from "./mock-fixtures.js";
import { MockTradeEngine, type MockTradeEngineOptions } from "./mock-trade-engine.js";
import {
  executeOutputSchema,
  getReceiptOutputSchema,
} from "./mcp-output-schema.js";
import { toolResult } from "./tool-result.js";

const mockReadOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const idempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const mcpTradeAssetValues = [
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
  "arb",
] as const;

export const MOCK_TOOLS = [
  "conviction_account_status",
  "conviction_mock_interaction",
  "conviction_quote_trade",
  "conviction_execute_trade",
  "conviction_get_receipt",
  "conviction_publish_conviction",
  "conviction_quote_back",
  "conviction_back_conviction",
] as const;

export type CreateMockServerOptions = MockTradeEngineOptions & {
  engine?: MockTradeEngine;
};

export async function createMockServer(
  options: CreateMockServerOptions = {},
): Promise<McpServer> {
  const engine =
    options.engine ??
    (await MockTradeEngine.create({
      ...(options.durableDir ? { durableDir: options.durableDir } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.randomId ? { randomId: options.randomId } : {}),
      ...(options.simulateStaleQuote !== undefined
        ? { simulateStaleQuote: options.simulateStaleQuote }
        : {}),
      ...(options.policy ? { policy: options.policy } : {}),
    }));

  const server = new McpServer(
    {
      name: "conviction-mcp",
      version: "1.0.0",
    },
    {
      instructions:
        "Deterministic mock mode only. Quote before execute. Execution outcomes use the same submitted, pending, finalized, partial, failed, and needs_attention lifecycle as live mode; only finalized is successful or publishable, and same-key retries never re-execute. It uses no account credentials, signer, signing material, Particle, network services, or real funds.",
    },
  );

  server.registerTool(
    "conviction_account_status",
    {
      title: "Get mock Conviction account status",
      description:
        "Return deterministic mock account state without accessing a live account.",
      inputSchema: {},
      annotations: mockReadOnlyAnnotations,
    },
    async () => toolResult(engine.accountStatus()),
  );

  server.registerTool(
    "conviction_mock_interaction",
    {
      title: "Run a deterministic mock interaction",
      description:
        "Return a structured deterministic success or error for host integration checks.",
      inputSchema: mockInteractionInputSchema,
      outputSchema: mockInteractionOutputSchema,
      annotations: mockReadOnlyAnnotations,
    },
    async ({ scenario }: { scenario: MockInteractionScenario }) => {
      const structuredContent = mockInteractionResult(scenario);
      return toolResult(structuredContent, !structuredContent.ok);
    },
  );

  const mcpTradeAsset = z.enum(mcpTradeAssetValues);
  const mcpTradeQuoteInput = z
    .object({
      toAsset: mcpTradeAsset,
      fromAsset: mcpTradeAsset.optional(),
      sizeUsd: z.number().positive().optional(),
      fraction: z.number().gt(0).max(1).optional(),
      destChain: z.enum(["Arbitrum", "Base"]).optional(),
      publicationIntent: z.boolean().optional(),
    })
    .passthrough();
  mcpTradeQuoteInput._zod.toJSONSchema = () => ({
    type: "object",
    properties: {
      toAsset: { type: "string", enum: [...mcpTradeAssetValues] },
      fromAsset: { type: "string", enum: [...mcpTradeAssetValues] },
      sizeUsd: { type: "number", exclusiveMinimum: 0 },
      fraction: { type: "number", exclusiveMinimum: 0, maximum: 1 },
      destChain: { type: "string", enum: ["Arbitrum", "Base"] },
      publicationIntent: { type: "boolean" },
    },
    required: ["toAsset"],
    oneOf: [
      {
        required: ["sizeUsd"],
        not: { required: ["fraction"] },
      },
      {
        required: ["fraction"],
        not: { required: ["sizeUsd"] },
      },
    ],
    additionalProperties: false,
  });

  server.registerTool(
    "conviction_quote_trade",
    {
      title: "Quote a structured mock trade",
      description:
        "Validate structured trade fields and return a short-lived mock quote with costs, floor, exact expiresAt, and quoteId. Moves no funds.",
      inputSchema: mcpTradeQuoteInput,
      annotations: mockReadOnlyAnnotations,
    },
    async (args) => {
      const result = await engine.quoteTrade(args as Record<string, unknown>);
      return toolResult(result, !result.ok);
    },
  );

  server.registerTool(
    "conviction_execute_trade",
    {
      title: "Execute a mock trade quote",
      description:
        "Execute a recent mock trade quote by quoteId. Deterministically returns finalized success; lifecycle fixtures use the same submitted, pending, partial, failed, and needs_attention terminology as live mode. Never requotes or re-executes.",
      inputSchema: {
        quoteId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      },
      outputSchema: executeOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ quoteId, idempotencyKey }) => {
      const result = await engine.executeTrade({ quoteId, idempotencyKey });
      return toolResult(result, !result.ok);
    },
  );

  server.registerTool(
    "conviction_get_receipt",
    {
      title: "Get a mock receipt",
      description:
        "Retrieve deterministic lifecycle evidence using the same contract as live mode. Use mock-execution-pending or mock-execution-partial for representative unresolved fixtures; generated executions finalize. Explorer links represent confirmed mock hashes only.",
      inputSchema: {
        receiptId: z.string().min(1),
      },
      outputSchema: getReceiptOutputSchema,
      annotations: mockReadOnlyAnnotations,
    },
    async ({ receiptId }) => {
      const result = await engine.getReceipt(receiptId);
      return toolResult(result, !result.ok);
    },
  );

  server.registerTool(
    "conviction_publish_conviction",
    {
      title: "Publish a mock conviction",
      description:
        "Publish a finalized confirmed mock trade plus thesis, why-now, and what-breaks-it. Non-finalized lifecycle outcomes are never eligible.",
      inputSchema: {
        receiptId: z.string().min(1),
        thesis: z.string().min(1),
        whyNow: z.string().min(1),
        whatBreaksIt: z.string().min(1),
      },
      annotations: idempotentWriteAnnotations,
    },
    async ({ receiptId, thesis, whyNow, whatBreaksIt }) => {
      const result = await engine.publishConviction({
        receiptId,
        thesis,
        whyNow,
        whatBreaksIt,
      });
      return toolResult(result, !result.ok);
    },
  );

  const mcpBackQuoteInput = z
    .object({
      entryId: z.string().min(1),
      dollarsIn: z.number().positive().optional(),
      fraction: z.number().gt(0).max(1).optional(),
    })
    .passthrough();

  server.registerTool(
    "conviction_quote_back",
    {
      title: "Quote backing a mock conviction",
      description:
        "Size and quote backing an existing mock conviction. Derives the target from the canonical entry. Moves no funds.",
      inputSchema: mcpBackQuoteInput,
      annotations: mockReadOnlyAnnotations,
    },
    async (args) => {
      const result = await engine.quoteBack(args as Record<string, unknown>);
      return toolResult(result, !result.ok);
    },
  );

  server.registerTool(
    "conviction_back_conviction",
    {
      title: "Back a mock conviction",
      description:
        "Execute a recent mock back quote and create durable attribution only after finalized confirmed execution. Never requotes, re-signs, or re-executes.",
      inputSchema: {
        quoteId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      },
      outputSchema: executeOutputSchema,
      annotations: idempotentWriteAnnotations,
    },
    async ({ quoteId, idempotencyKey }) => {
      const result = await engine.backConviction({ quoteId, idempotencyKey });
      return toolResult(result, !result.ok);
    },
  );

  return server;
}
