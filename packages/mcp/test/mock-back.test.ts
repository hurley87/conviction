import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMockServer } from "../src/mock-server.js";
import {
  MOCK_BACKABLE_ENTRY,
  MockTradeEngine,
} from "../src/mock-trade-engine.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function connectMock(durableDir?: string) {
  const server = await createMockServer(
    durableDir ? { durableDir } : undefined,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mock-back-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

function structured(result: {
  structuredContent?: unknown;
  content?: Array<{ type: string; text?: string }>;
}) {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((part) => part.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

describe("mock conviction_quote_back / conviction_back_conviction", () => {
  it("quotes from the canonical conviction, executes once, and attributes the agent", async () => {
    const client = await connectMock();
    const quoted = structured(
      await client.callTool({
        name: "conviction_quote_back",
        arguments: {
          entryId: MOCK_BACKABLE_ENTRY.entryId,
          dollarsIn: 10,
        },
      }),
    ) as {
      ok: boolean;
      action: string;
      quoteId: string;
      entryId: string;
      toAsset: string;
    };

    expect(quoted.ok).toBe(true);
    expect(quoted.action).toBe("back");
    expect(quoted.entryId).toBe(MOCK_BACKABLE_ENTRY.entryId);
    expect(quoted.toAsset).toBe("eth");

    const backed = structured(
      await client.callTool({
        name: "conviction_back_conviction",
        arguments: {
          quoteId: quoted.quoteId,
          idempotencyKey: "mock-back-1",
        },
      }),
    ) as {
      ok: boolean;
      action: string;
      backRecordId: string;
      reconciliationState: string;
      authorship: { authorKind: string; handle: string };
      receiptId: string;
    };

    expect(backed.ok).toBe(true);
    expect(backed.action).toBe("back");
    expect(backed.backRecordId).toBeTruthy();
    expect(backed.reconciliationState).toBe("complete");
    expect(backed.authorship.authorKind).toBe("agent");

    const retry = structured(
      await client.callTool({
        name: "conviction_back_conviction",
        arguments: {
          quoteId: quoted.quoteId,
          idempotencyKey: "mock-back-1",
        },
      }),
    ) as { ok: boolean; backRecordId: string; receiptId: string };

    expect(retry.ok).toBe(true);
    expect(retry.backRecordId).toBe(backed.backRecordId);
    expect(retry.receiptId).toBe(backed.receiptId);
  });

  it("quotes back size from fraction of balance", async () => {
    const client = await connectMock();
    const quoted = structured(
      await client.callTool({
        name: "conviction_quote_back",
        arguments: {
          entryId: MOCK_BACKABLE_ENTRY.entryId,
          fraction: 0.1,
        },
      }),
    ) as { ok: boolean; dollarsIn: number; action: string };

    expect(quoted.ok).toBe(true);
    expect(quoted.action).toBe("back");
    expect(quoted.dollarsIn).toBeGreaterThan(0);
  });

  it("stores agent authorship on the canonical conviction attribution", async () => {
    const engine = await MockTradeEngine.create();
    const quoted = await engine.quoteBack({
      entryId: MOCK_BACKABLE_ENTRY.entryId,
      dollarsIn: 8,
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    const backed = await engine.backConviction({
      quoteId: quoted.quoteId,
      idempotencyKey: "mock-attr-1",
    });
    expect(backed.ok).toBe(true);
    if (!backed.ok) return;

    const conviction = engine.getConvictionForTests(MOCK_BACKABLE_ENTRY.entryId);
    expect(conviction?.backedBy).toContain(backed.authorship.handle);
    expect(conviction?.backerAttributions).toEqual([
      {
        handle: backed.authorship.handle,
        authorship: backed.authorship,
      },
    ]);
  });

  it("rejects arbitrary token overrides on quote_back", async () => {
    const client = await connectMock();
    const result = structured(
      await client.callTool({
        name: "conviction_quote_back",
        arguments: {
          entryId: MOCK_BACKABLE_ENTRY.entryId,
          dollarsIn: 10,
          tokenAddress: "0xabc",
        },
      }),
    ) as { ok: boolean; code: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe("arbitrary_token_rejected");
  });

  it("survives restart with durable back idempotency", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mock-back-"));
    cleanup.push(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const first = await connectMock(dir);
    const quoted = structured(
      await first.callTool({
        name: "conviction_quote_back",
        arguments: {
          entryId: MOCK_BACKABLE_ENTRY.entryId,
          dollarsIn: 5,
        },
      }),
    ) as { ok: boolean; quoteId: string };
    expect(quoted.ok).toBe(true);

    const backed = structured(
      await first.callTool({
        name: "conviction_back_conviction",
        arguments: {
          quoteId: quoted.quoteId,
          idempotencyKey: "durable-back",
        },
      }),
    ) as { ok: boolean; backRecordId: string; receiptId: string };
    expect(backed.ok).toBe(true);

    await first.close();
    cleanup.pop();

    const second = await connectMock(dir);
    const retry = structured(
      await second.callTool({
        name: "conviction_back_conviction",
        arguments: {
          quoteId: quoted.quoteId,
          idempotencyKey: "durable-back",
        },
      }),
    ) as { ok: boolean; backRecordId: string; receiptId: string };

    expect(retry.ok).toBe(true);
    expect(retry.backRecordId).toBe(backed.backRecordId);
    expect(retry.receiptId).toBe(backed.receiptId);
  });
});
