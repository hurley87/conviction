import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createMockServer } from "../src/mock-server.js";
import { MockTradeEngine } from "../src/mock-trade-engine.js";

async function withClient(
  engine: MockTradeEngine,
  run: (client: Client) => Promise<void>,
) {
  const server = await createMockServer({ engine });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mock-publish-test", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("mock conviction_publish_conviction", () => {
  it("publishes once from a successful execute receipt and is idempotent", async () => {
    const engine = await MockTradeEngine.create({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      randomId: () => "11111111-1111-4111-8111-111111111157",
    });

    await withClient(engine, async (client) => {
      const quote = await client.callTool({
        name: "conviction_quote_trade",
        arguments: {
          toAsset: "eth",
          sizeUsd: 20,
          destChain: "Arbitrum",
          publicationIntent: true,
        },
      });
      expect(quote.isError).toBeFalsy();
      const quoteContent = quote.structuredContent as { quoteId: string };

      const executed = await client.callTool({
        name: "conviction_execute_trade",
        arguments: {
          quoteId: quoteContent.quoteId,
          idempotencyKey: "idem-mock-publish",
        },
      });
      expect(executed.isError).toBeFalsy();
      const execContent = executed.structuredContent as { receiptId: string };

      const published = await client.callTool({
        name: "conviction_publish_conviction",
        arguments: {
          receiptId: execContent.receiptId,
          thesis: "Mock ETH thesis",
          whyNow: "Mock catalyst",
          whatBreaksIt: "Mock invalidation",
        },
      });
      expect(published.isError).toBeFalsy();
      const first = published.structuredContent as {
        ok: true;
        entryId: string;
        entry: {
          authorship: { authorKind: "agent"; operatorHandle: string };
          gateReport: Array<{ passed: boolean }>;
        };
      };
      expect(first.ok).toBe(true);
      expect(first.entry.authorship.authorKind).toBe("agent");
      expect(first.entry.authorship.operatorHandle).toBe("mock-operator");
      expect(first.entry.gateReport.every((check) => check.passed)).toBe(true);

      const retry = await client.callTool({
        name: "conviction_publish_conviction",
        arguments: {
          receiptId: execContent.receiptId,
          thesis: "Different thesis should not create a second card",
          whyNow: "Different why",
          whatBreaksIt: "Different break",
        },
      });
      expect(retry.isError).toBeFalsy();
      const second = retry.structuredContent as {
        ok: true;
        entryId: string;
      };
      expect(second.entryId).toBe(first.entryId);
    });
  });

  it("survives restart with durable publishable state", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-publish-"));
    try {
      const engine = await MockTradeEngine.create({
        durableDir: dir,
        now: () => new Date("2026-07-17T12:00:00.000Z"),
        randomId: () => "22222222-2222-4222-8222-222222222222",
      });
      const quote = await engine.quoteTrade({
        toAsset: "eth",
        sizeUsd: 15,
        destChain: "Arbitrum",
      });
      if (!quote.ok) throw new Error("quote failed");
      const executed = await engine.executeTrade({
        quoteId: quote.quoteId,
        idempotencyKey: "idem-durable-publish",
      });
      if (!executed.ok) throw new Error("execute failed");

      const restarted = await MockTradeEngine.create({
        durableDir: dir,
        now: () => new Date("2026-07-17T12:05:00.000Z"),
        randomId: () => "33333333-3333-4333-8333-333333333333",
      });
      const published = await restarted.publishConviction({
        receiptId: executed.receiptId,
        thesis: "Durable thesis",
        whyNow: "Durable why",
        whatBreaksIt: "Durable break",
      });
      expect(published.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
