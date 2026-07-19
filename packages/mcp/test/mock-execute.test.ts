import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createMockServer, MOCK_TOOLS } from "../src/mock-server.js";
import { MockTradeEngine } from "../src/mock-trade-engine.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function connectMock(options?: {
  durableDir?: string;
  engine?: MockTradeEngine;
  now?: () => Date;
  simulateStaleQuote?: boolean;
  policy?: ConstructorParameters<typeof MockTradeEngine>[0] extends infer O
    ? O extends { policy?: infer P }
      ? P
      : never
    : never;
}) {
  const server = await createMockServer({
    ...(options?.durableDir ? { durableDir: options.durableDir } : {}),
    ...(options?.engine ? { engine: options.engine } : {}),
    ...(options?.now ? { now: options.now } : {}),
    ...(options?.simulateStaleQuote !== undefined
      ? { simulateStaleQuote: options.simulateStaleQuote }
      : {}),
    ...(options?.policy ? { policy: options.policy } : {}),
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mock-execute-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("mock trade execute", () => {
  it("lists quote, execute, and receipt tools", async () => {
    const client = await connectMock();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...MOCK_TOOLS]);
  });

  it("quotes, executes, and retrieves a durable mock receipt", async () => {
    const client = await connectMock({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });

    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
    });
    expect(quote.isError).toBeUndefined();
    const quoteBody = quote.structuredContent as {
      ok: true;
      quoteId: string;
      floorUsd: number;
    };
    expect(quoteBody.ok).toBe(true);

    const executed = await client.callTool({
      name: "conviction_execute_trade",
      arguments: {
        quoteId: quoteBody.quoteId,
        idempotencyKey: "mock-idem-1",
      },
    });
    expect(executed.isError).toBeUndefined();
    const execBody = executed.structuredContent as {
      ok: true;
      mode: "mock";
      receiptId: string;
      receipt: { legs: unknown[] };
    };
    expect(execBody).toMatchObject({
      ok: true,
      mode: "mock",
      quoteId: quoteBody.quoteId,
    });
    expect(execBody.receipt.legs.length).toBe(2);

    const receipt = await client.callTool({
      name: "conviction_get_receipt",
      arguments: { receiptId: execBody.receiptId },
    });
    expect(receipt.structuredContent).toMatchObject({
      ok: true,
      mode: "mock",
      receiptId: execBody.receiptId,
      outcome: "finalized",
    });
  });

  it.each([
    ["mock-execution-pending", "pending"],
    ["mock-execution-partial", "partial"],
  ] as const)("serves deterministic %s lifecycle evidence", async (receiptId, outcome) => {
    const client = await connectMock();
    const result = await client.callTool({
      name: "conviction_get_receipt",
      arguments: { receiptId },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      receiptId,
      outcome,
      receipt: null,
      execution: { executionId: receiptId, outcome },
    });
  });

  it("rejects policy-disabled trades with action_disabled", async () => {
    const client = await connectMock({
      policy: { actionPolicy: { trade: false, back: true, publish: true } },
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });

    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 10 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;

    const executed = await client.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-disabled" },
    });
    expect(executed.isError).toBe(true);
    expect(executed.structuredContent).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "trade",
    });
  });

  it("rejects expired quotes without creating a replacement quote", async () => {
    let nowMs = Date.parse("2026-07-17T12:00:00.000Z");
    const engine = await MockTradeEngine.create({
      now: () => new Date(nowMs),
    });
    const client = await connectMock({ engine });

    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 10 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;
    const before = engine.quoteCount();

    nowMs += 61_000;
    const executed = await client.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-expired" },
    });

    expect(executed.structuredContent).toMatchObject({
      ok: false,
      code: "quote_expired",
    });
    expect(engine.quoteCount()).toBe(before);
  });

  it("returns price_floor_breached without silently requoting", async () => {
    const engine = await MockTradeEngine.create({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
      simulateStaleQuote: true,
    });
    const client = await connectMock({ engine });

    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 10 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;
    const before = engine.quoteCount();

    const executed = await client.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-floor" },
    });

    expect(executed.structuredContent).toMatchObject({
      ok: false,
      code: "price_floor_breached",
      quoteId,
    });
    expect(engine.quoteCount()).toBe(before);
    // Claim-before-side-effect: attempt consumes quote; host must requote.
    const retry = await client.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-floor-2" },
    });
    expect(retry.structuredContent).toMatchObject({
      ok: false,
      code: "quote_mismatch",
    });
  });

  it("never double-executes one quote under different idempotency keys", async () => {
    const engine = await MockTradeEngine.create({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });
    const client = await connectMock({ engine });
    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 15 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;

    const [a, b] = await Promise.all([
      client.callTool({
        name: "conviction_execute_trade",
        arguments: { quoteId, idempotencyKey: "mock-key-a" },
      }),
      client.callTool({
        name: "conviction_execute_trade",
        arguments: { quoteId, idempotencyKey: "mock-key-b" },
      }),
    ]);

    const bodies = [a.structuredContent, b.structuredContent] as Array<{
      ok: boolean;
      code?: string;
    }>;
    expect(bodies.filter((body) => body.ok)).toHaveLength(1);
    expect(bodies.filter((body) => !body.ok)).toHaveLength(1);
    expect(bodies.find((body) => !body.ok)?.code).toBe("quote_mismatch");
    expect(engine.providerAttempts).toBe(1);
  });

  it("returns the same result for retries and concurrent idempotency keys", async () => {
    const client = await connectMock({
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });
    const quote = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 15 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;

    const [a, b] = await Promise.all([
      client.callTool({
        name: "conviction_execute_trade",
        arguments: { quoteId, idempotencyKey: "mock-idem-concurrent" },
      }),
      client.callTool({
        name: "conviction_execute_trade",
        arguments: { quoteId, idempotencyKey: "mock-idem-concurrent" },
      }),
    ]);
    expect(a.structuredContent).toEqual(b.structuredContent);
    expect(a.structuredContent).toMatchObject({ ok: true });

    const retry = await client.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-concurrent" },
    });
    expect(retry.structuredContent).toEqual(a.structuredContent);
  });

  it("survives process restart via durable mock state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-mock-trade-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));
    const durableDir = path.join(home, "mock");

    const firstServer = await createMockServer({
      durableDir,
      now: () => new Date("2026-07-17T12:00:00.000Z"),
    });
    const [c1t, s1t] = InMemoryTransport.createLinkedPair();
    const client1 = new Client({ name: "restart-1", version: "1.0.0" });
    await firstServer.connect(s1t);
    await client1.connect(c1t);

    const quote = await client1.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth", sizeUsd: 12 },
    });
    const quoteId = (quote.structuredContent as { quoteId: string }).quoteId;
    const first = await client1.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId, idempotencyKey: "mock-idem-restart" },
    });
    expect(first.structuredContent).toMatchObject({ ok: true });
    await client1.close();
    await firstServer.close();

    const secondServer = await createMockServer({
      durableDir,
      // Hostile clock / policy — idempotent result must still win.
      now: () => new Date("2099-01-01T00:00:00.000Z"),
      policy: {
        status: "disabled",
        actionPolicy: { trade: false, back: false, publish: false },
        balanceUsd: 0,
      },
    });
    const [c2t, s2t] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: "restart-2", version: "1.0.0" });
    await secondServer.connect(s2t);
    await client2.connect(c2t);
    cleanup.push(async () => {
      await client2.close();
      await secondServer.close();
    });

    const retry = await client2.callTool({
      name: "conviction_execute_trade",
      arguments: { quoteId: "missing", idempotencyKey: "mock-idem-restart" },
    });
    expect(retry.structuredContent).toEqual(first.structuredContent);

    const entries = await readdir(durableDir);
    expect(entries).toContain("trade-state.json");
  });

  it("does not import remote trading providers or local signing modules", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "../src/mock-trade-engine.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /from ["'].*(particle|keystore|live-api-client|signed-request)/i,
    );
  });
});
