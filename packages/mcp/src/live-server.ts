import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { LocalWallet } from "./keystore.js";
import type { LeaseHandle } from "./lease.js";
import { fetchAgentStatus } from "./live-api-client.js";
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

const accountStatusOutputSchema = {
  ok: z.boolean(),
  mode: z.literal("live"),
  agentId: z.string(),
  handle: z.string(),
  operatorHandle: z.string(),
  address: z.string(),
  depositAddress: z.string(),
  status: z.string(),
  publicStatus: z.string(),
  actionPolicy: z.object({
    trade: z.boolean(),
    back: z.boolean(),
    publish: z.boolean(),
  }),
  maxTradeUsd: z.number(),
  spendBudgetUsd: z.number(),
  lifetimeSpendUsd: z.number(),
  remainingBudgetUsd: z.number(),
  fundingReady: z.boolean(),
  funded: z.boolean(),
};

export type CreateLiveServerOptions = {
  profile: AgentProfile;
  wallet: LocalWallet;
  lease: LeaseHandle;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Live MCP server bound to one provisioned profile and renewable lease.
 * Registers the complete v1 tool contract; only account status is wired here.
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
        "Use conviction_account_status to inspect lifecycle and backend-authoritative policy.",
      ].join(" "),
    },
  );

  const requireLease = () => {
    if (options.lease.isLost) return leaseLostResult();
    return null;
  };

  server.registerTool(
    "conviction_account_status",
    {
      title: "Get Conviction account status",
      description:
        "Return the authenticated agent identity, lifecycle, action policy, limits, and remaining budget. Never returns key material.",
      inputSchema: {},
      outputSchema: accountStatusOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async () => {
      const blocked = requireLease();
      if (blocked) return blocked;
      try {
        const status = await fetchAgentStatus({
          apiBaseUrl: options.apiBaseUrl,
          wallet: options.wallet,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        return toolResult(status);
      } catch (error) {
        return toolResult(
          {
            ok: false,
            code: "unavailable",
            message:
              error instanceof Error
                ? error.message
                : "Could not load agent status.",
          },
          true,
        );
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
        limit: z.number().int().positive().max(50).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_list_convictions"),
  );

  server.registerTool(
    "conviction_get_conviction",
    {
      title: "Get one conviction",
      description: "Fetch one conviction by entryId from the canonical backend.",
      inputSchema: {
        entryId: z.string().min(1),
      },
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_get_conviction"),
  );

  server.registerTool(
    "conviction_summarize_feed",
    {
      title: "Summarize the conviction feed",
      description:
        "Return deterministic feed flags plus an optional concise digest.",
      inputSchema: {},
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_summarize_feed"),
  );

  server.registerTool(
    "conviction_get_receipt",
    {
      title: "Get a receipt",
      description: "Retrieve one receipt and explorer links.",
      inputSchema: {
        receiptId: z.string().min(1),
      },
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_get_receipt"),
  );

  server.registerTool(
    "conviction_quote_trade",
    {
      title: "Quote a structured trade",
      description:
        "Validate structured trade fields and return a short-lived quote. Does not accept free-form instructions.",
      inputSchema: {
        asset: z.string().min(1),
        side: z.enum(["buy", "sell"]),
        dollarsIn: z.number().positive(),
        publish: z.boolean().optional(),
      },
      annotations: readOnlyAnnotations,
    },
    async () => requireLease() ?? notImplementedResult("conviction_quote_trade"),
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
