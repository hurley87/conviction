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
        "Deterministic mock mode only. Quote with conviction_quote_trade, execute with conviction_execute_trade, then optionally publish with conviction_publish_conviction using the receiptId. It uses no account credentials, signer, signing material, Particle, network services, or real funds.",
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
        "Execute a recent mock trade quote by quoteId. Never silently requotes. Uses no Particle, signer, or real funds.",
      inputSchema: {
        quoteId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      },
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
      description: "Retrieve one mock receipt and explorer links.",
      inputSchema: {
        receiptId: z.string().min(1),
      },
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
        "Publish a completed mock trade plus thesis, why-now, and what-breaks-it. Requires a successful unique owned receipt.",
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

  return server;
}
