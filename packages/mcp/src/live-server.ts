import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  accountStatusOutputSchema,
  getConvictionOutputSchema,
  getReceiptOutputSchema,
  listConvictionsOutputSchema,
  MAX_CONVICTION_PAGE_LIMIT,
  summarizeFeedOutputSchema,
} from "./agent-reads-contract.js";
import { ConvictionApiError } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import type { LeaseHandle } from "./lease.js";
import {
  fetchAgentStatus,
  fetchConviction,
  fetchConvictionsPage,
  fetchFeedSummary,
  fetchReceipt,
  requestTradeQuote,
} from "./live-api-client.js";
import type { AgentProfile } from "./profile.js";
import { toolResult } from "./tool-result.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies ToolAnnotations;

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} satisfies ToolAnnotations;

const idempotentWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;

/** Canonical v1 tool names — always discoverable (ADR 0047). */
export const LIVE_TOOLS = [
  "conviction_account_status",
  "conviction_list_convictions",
  "conviction_get_conviction",
  "conviction_summarize_feed",
  "conviction_get_receipt",
  "conviction_quote_trade",
  "conviction_execute_trade",
  "conviction_publish_conviction",
  "conviction_quote_back",
  "conviction_back_conviction",
] as const;

export type LiveToolName = (typeof LIVE_TOOLS)[number];

function leaseLostResult() {
  return toolResult(
    {
      ok: false,
      code: "lease_lost",
      message:
        "The MCP lease is no longer valid. Restart the server to reconnect.",
    },
    true,
  );
}

function notImplementedResult(tool: string) {
  return toolResult(
    {
      ok: false,
      code: "not_implemented",
      message: `${tool} is registered in the v1 contract but not implemented in this slice.`,
    },
    true,
  );
}

function unavailableResult(error: unknown, fallback: string) {
  if (error instanceof ConvictionApiError) {
    return toolResult(
      {
        ok: false,
        code: error.code,
        message: error.message,
      },
      true,
    );
  }
  return toolResult(
    {
      ok: false,
      code: "unavailable",
      message: error instanceof Error ? error.message : fallback,
    },
    true,
  );
}

export type CreateLiveServerOptions = {
  profile: AgentProfile;
  wallet: LocalWallet;
  lease: LeaseHandle;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Live MCP server bound to one provisioned profile and renewable lease.
 * Registers the complete v1 tool contract; network read tools and trade
 * quoting are wired here (#51 / #53 / #54).
 */
export function createLiveServer(options: CreateLiveServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "conviction-mcp",
      version: "1.0.0",
    },
    {
      instructions: [
        "Conviction MCP live mode for one agent Universal Account.",
        "Quote before execute for all value-moving actions.",
        "The model never chooses identity, destination addresses, or signing material.",
        "Use conviction_account_status, conviction_list_convictions, conviction_get_conviction, conviction_summarize_feed, and conviction_get_receipt to inspect the network.",
      ].join(" "),
    },
  );

  const requireLease = () => {
    if (!options.lease.isActive) return leaseLostResult();
    return null;
  };

  const apiOptions = () => ({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  server.registerTool(
    "conviction_account_status",
    {
      title: "Get Conviction account status",
      description:
        "Return the authenticated agent identity, unified balance, deposit information, lifecycle, action policy, limits, and remaining budget. Never returns key material.",
      inputSchema: {},
      outputSchema: accountStatusOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const status = await fetchAgentStatus(apiOptions());
        return toolResult(status);
      } catch (error) {
        return unavailableResult(error, "Could not load agent status.");
      }
    },
  );

  server.registerTool(
    "conviction_list_convictions",
    {
      title: "List convictions",
      description:
        "List current deck or feed convictions with bounded pagination.",
      inputSchema: {
        cursor: z.string().optional(),
        limit: z.number().int().positive().max(MAX_CONVICTION_PAGE_LIMIT).optional(),
      },
      outputSchema: listConvictionsOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ cursor, limit }) => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const page = await fetchConvictionsPage({
          ...apiOptions(),
          ...(cursor ? { cursor } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        return toolResult(page);
      } catch (error) {
        return unavailableResult(error, "Could not list convictions.");
      }
    },
  );

  server.registerTool(
    "conviction_get_conviction",
    {
      title: "Get one conviction",
      description: "Fetch one conviction by entryId from the canonical backend.",
      inputSchema: {
        entryId: z.string().min(1),
      },
      outputSchema: getConvictionOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ entryId }) => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const result = await fetchConviction({
          ...apiOptions(),
          entryId,
        });
        return toolResult(result);
      } catch (error) {
        return unavailableResult(error, "Could not load conviction.");
      }
    },
  );

  server.registerTool(
    "conviction_summarize_feed",
    {
      title: "Summarize the conviction feed",
      description:
        "Return deterministic feed flags plus an optional concise digest.",
      inputSchema: {},
      outputSchema: summarizeFeedOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const summary = await fetchFeedSummary(apiOptions());
        return toolResult(summary);
      } catch (error) {
        return unavailableResult(error, "Could not summarize the feed.");
      }
    },
  );

  server.registerTool(
    "conviction_get_receipt",
    {
      title: "Get a receipt",
      description: "Retrieve one receipt and explorer links.",
      inputSchema: {
        receiptId: z.string().min(1),
      },
      outputSchema: getReceiptOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ receiptId }) => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const result = await fetchReceipt({
          ...apiOptions(),
          receiptId,
        });
        return toolResult(result);
      } catch (error) {
        return unavailableResult(error, "Could not load receipt.");
      }
    },
  );

  const mcpTradeAssetValues = [
    "cash",
    "eth",
    "usdc",
    "usdt",
    "btc",
    "sol",
    "arb",
  ] as const;
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
  // The MCP SDK only advertises object-shaped Zod schemas. Supply the
  // relationship that Zod refinements cannot express in generated JSON Schema
  // while keeping runtime passthrough so forbidden fields receive stable codes.
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
  const mcpTradeQuoteKeys = new Set([
    "toAsset",
    "fromAsset",
    "sizeUsd",
    "fraction",
    "destChain",
    "publicationIntent",
  ]);

  server.registerTool(
    "conviction_quote_trade",
    {
      title: "Quote a structured trade",
      description:
        "Validate structured trade fields and return a short-lived quote with costs, floor, exact expiresAt, and quoteId. Named product assets only — no free-form text, contract addresses, or TokenRef. Available even when trading is disabled or the account is unfunded; moves no funds.",
      inputSchema: mcpTradeQuoteInput,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const blocked = requireLease();
      if (blocked) return blocked;

      const unknownKeys = Object.keys(args).filter(
        (key) => !mcpTradeQuoteKeys.has(key),
      );
      if (unknownKeys.length > 0) {
        const looksLikeToken = unknownKeys.some((key) =>
          /token|address|contract|chainId/i.test(key),
        );
        return toolResult(
          {
            ok: false,
            code: looksLikeToken
              ? "arbitrary_token_rejected"
              : "invalid_input",
            message: looksLikeToken
              ? "Direct MCP trades accept named product assets only. Contract addresses and TokenRef fields are rejected."
              : "Structured trade fields include unsupported keys.",
            fields: unknownKeys.map((field) => ({
              field,
              code: looksLikeToken ? "forbidden_field" : "unknown_field",
              message: looksLikeToken
                ? `Remove "${field}". Use a named product asset instead.`
                : `Unknown field "${field}".`,
            })),
          },
          true,
        );
      }

      const hasSize = args.sizeUsd !== undefined;
      const hasFraction = args.fraction !== undefined;
      if (hasSize === hasFraction) {
        return toolResult(
          {
            ok: false,
            code: "invalid_input",
            message:
              "Provide exactly one of sizeUsd (positive dollars) or fraction (0–1 of balance).",
            fields: [
              {
                field: "sizeUsd|fraction",
                code: "size_required",
                message:
                  "Provide exactly one of sizeUsd or fraction — not both, not neither.",
              },
            ],
          },
          true,
        );
      }

      try {
        const quote = await requestTradeQuote({
          apiBaseUrl: options.apiBaseUrl,
          wallet: options.wallet,
          input: {
            toAsset: args.toAsset,
            ...(args.fromAsset ? { fromAsset: args.fromAsset } : {}),
            ...(args.sizeUsd !== undefined ? { sizeUsd: args.sizeUsd } : {}),
            ...(args.fraction !== undefined ? { fraction: args.fraction } : {}),
            ...(args.destChain ? { destChain: args.destChain } : {}),
            ...(args.publicationIntent !== undefined
              ? { publicationIntent: args.publicationIntent }
              : {}),
          },
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        return toolResult(quote);
      } catch (error) {
        if (error instanceof ConvictionApiError) {
          return toolResult(
            {
              ok: false,
              code: error.code,
              message: error.message,
              ...(error.details.fields ? { fields: error.details.fields } : {}),
              ...(error.details.gateReport
                ? { gateReport: error.details.gateReport }
                : {}),
              ...(error.details.preview
                ? { preview: error.details.preview }
                : {}),
            },
            true,
          );
        }
        return toolResult(
          {
            ok: false,
            code: "unavailable",
            message:
              error instanceof Error
                ? error.message
                : "Could not quote structured trade.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "conviction_execute_trade",
    {
      title: "Execute a trade quote",
      description:
        "Execute a recent trade quote by quoteId. Never silently requotes.",
      inputSchema: {
        quoteId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      },
      annotations: idempotentWriteAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_execute_trade"),
  );

  server.registerTool(
    "conviction_publish_conviction",
    {
      title: "Publish a conviction",
      description:
        "Publish a completed trade plus thesis, why-now, and what-breaks-it.",
      inputSchema: {
        receiptId: z.string().min(1),
        thesis: z.string().min(1),
        whyNow: z.string().min(1),
        whatBreaksIt: z.string().min(1),
      },
      annotations: writeAnnotations,
    },
    async () =>
      requireLease() ?? notImplementedResult("conviction_publish_conviction"),
  );

  server.registerTool(
    "conviction_quote_back",
    {
      title: "Quote backing a conviction",
      description:
        "Size and quote backing an existing conviction. Moves no funds.",
      inputSchema: {
        entryId: z.string().min(1),
        dollarsIn: z.number().positive(),
      },
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_quote_back"),
  );

  server.registerTool(
    "conviction_back_conviction",
    {
      title: "Back a conviction",
      description:
        "Execute a recent back quote and create durable attribution.",
      inputSchema: {
        quoteId: z.string().min(1),
        idempotencyKey: z.string().min(1),
      },
      annotations: idempotentWriteAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_back_conviction"),
  );

  return server;
}
