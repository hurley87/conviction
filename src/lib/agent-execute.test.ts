import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MemoryAgentIdempotencyStore,
  MemoryAgentReceiptPersist,
  MemorySpendLedger,
  executeAgentTrade,
} from "@/lib/agent-execute";
import {
  MemoryAgentQuoteStore,
  issueTradeQuote,
} from "@/lib/agent-quote";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import { MockUAClient } from "@/lib/ua/mock";
import type { UniversalBalance } from "@/lib/verbs/types";

const FIXED_NOW = new Date("2026-07-17T12:00:00.000Z");

const FUNDED_BALANCE: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

function testAgent(overrides: Partial<OwnedAgent> = {}): OwnedAgent {
  return {
    agentId: "00000000-0000-4000-8000-000000000055",
    ownerUserId: "did:privy:owner-execute",
    handle: "exec-scout",
    authorKind: "agent",
    operatorHandle: "operator",
    address: "0x1111111111111111111111111111111111111111",
    returnAddress: "0x0000000000000000000000000000000000000001",
    status: "active",
    publicStatus: "active",
    actionPolicy: { trade: true, back: true, publish: true },
    maxTradeUsd: 25,
    spendBudgetUsd: 100,
    lifetimeSpendUsd: 0,
    fundingReady: true,
    setupVerifiedAt: null,
    createdAt: FIXED_NOW.toISOString(),
    ...overrides,
  };
}

async function quoteAndStores(options: {
  agent?: OwnedAgent;
  ua?: MockUAClient;
  sizeUsd?: number;
  now?: () => Date;
}) {
  const agent = options.agent ?? testAgent();
  const ua = options.ua ?? new MockUAClient({ sources: FUNDED_BALANCE.sources });
  const quoteStore = new MemoryAgentQuoteStore();
  const idempotencyStore = new MemoryAgentIdempotencyStore();
  const receipts = new MemoryAgentReceiptPersist();
  const quote = await issueTradeQuote({
    agent,
    body: {
      toAsset: "eth",
      sizeUsd: options.sizeUsd ?? 20,
      destChain: "Arbitrum",
    },
    ua,
    store: quoteStore,
    balance: FUNDED_BALANCE,
    now: options.now ?? (() => FIXED_NOW),
    randomId: () => "11111111-1111-4111-8111-111111111111",
  });
  return { agent, ua, quoteStore, idempotencyStore, receipts, quote };
}

describe("executeAgentTrade", () => {
  it("completes a successful mock execution and returns a durable receipt", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});

    const result = await executeAgentTrade({
      agent,
      input: {
        quoteId: quote.quoteId,
        idempotencyKey: "idem-success-1",
      },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
      randomId: () => "mock-receipt-001",
    });

    expect(result).toMatchObject({
      ok: true,
      receiptId: "mock-receipt-001",
      quoteId: quote.quoteId,
      idempotencyKey: "idem-success-1",
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.receipt.legs.length).toBeGreaterThanOrEqual(2);
    expect(await receipts.get("mock-receipt-001")).toMatchObject({
      receipt: { slug: "mock-receipt-001" },
    });
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(true);
  });

  it("returns the stored idempotent result before re-checking policy", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});

    const first = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-retry" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
      randomId: () => "mock-receipt-retry",
    });

    const disabled = testAgent({
      actionPolicy: { trade: false, back: true, publish: true },
      status: "disabled",
      publicStatus: "paused",
    });

    const second = await executeAgentTrade({
      agent: disabled,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-retry" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: { totalUsd: 0, sources: [] },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({ ok: true });
  });

  it("collapses concurrent executes with the same idempotency key into one result", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});

    const [a, b] = await Promise.all([
      executeAgentTrade({
        agent,
        input: { quoteId: quote.quoteId, idempotencyKey: "idem-concurrent" },
        quoteStore,
        idempotencyStore,
        receipts,
        ua,
        balance: FUNDED_BALANCE,
        now: () => FIXED_NOW,
        randomId: () => "mock-receipt-concurrent",
      }),
      executeAgentTrade({
        agent,
        input: { quoteId: quote.quoteId, idempotencyKey: "idem-concurrent" },
        quoteStore,
        idempotencyStore,
        receipts,
        ua,
        balance: FUNDED_BALANCE,
        now: () => FIXED_NOW,
        randomId: () => "mock-receipt-concurrent-other",
      }),
    ]);

    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, receiptId: "mock-receipt-concurrent" });
  });

  it("rejects disabled trade with action_disabled after lifecycle allows", async () => {
    const agent = testAgent({
      actionPolicy: { trade: false, back: true, publish: true },
    });
    const { ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({ agent });

    const result = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-disabled" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "trade",
    });
  });

  it("prefers lifecycle_blocked over action_disabled", async () => {
    const agent = testAgent({
      status: "disabled",
      publicStatus: "paused",
      actionPolicy: { trade: false, back: true, publish: true },
    });
    const quoteStore = new MemoryAgentQuoteStore();
    // Seed a quote as if it was issued while still active.
    const active = testAgent();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
    const quote = await issueTradeQuote({
      agent: active,
      body: { toAsset: "eth", sizeUsd: 10, destChain: "Arbitrum" },
      ua,
      store: quoteStore,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
      randomId: () => "22222222-2222-4222-8222-222222222222",
    });

    const result = await executeAgentTrade({
      agent: { ...agent, agentId: active.agentId },
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-lifecycle" },
      quoteStore,
      idempotencyStore: new MemoryAgentIdempotencyStore(),
      receipts: new MemoryAgentReceiptPersist(),
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({ ok: false, code: "lifecycle_blocked" });
  });

  it("rejects expired quotes without producing a replacement quote", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});

    const beforeCount = quoteStore.size();
    const result = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-expired" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => new Date(FIXED_NOW.getTime() + 61_000),
    });

    expect(result).toMatchObject({ ok: false, code: "quote_expired" });
    expect(quoteStore.size()).toBe(beforeCount);
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(false);
  });

  it("maps floor abort to price_floor_breached without storing a replacement quote", async () => {
    const ua = new MockUAClient({
      sources: FUNDED_BALANCE.sources,
      simulateStaleQuote: true,
    });
    const { agent, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({ ua });

    const beforeCount = quoteStore.size();
    const result = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-floor" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "price_floor_breached",
      quoteId: quote.quoteId,
    });
    expect(quoteStore.size()).toBe(beforeCount);
    // Claim-before-provider: the attempt consumes the quote identity (ADR 0020).
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/freshQuote/);
  });

  it("never double-executes one quote under different idempotency keys", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});
    let executeCalls = 0;
    const original = ua.executeTrade.bind(ua);
    ua.executeTrade = async (params) => {
      executeCalls += 1;
      return original(params);
    };
    const spendLedger = new MemorySpendLedger();

    const [a, b] = await Promise.all([
      executeAgentTrade({
        agent,
        input: { quoteId: quote.quoteId, idempotencyKey: "idem-a" },
        quoteStore,
        idempotencyStore,
        receipts,
        ua,
        balance: FUNDED_BALANCE,
        spendLedger,
        now: () => FIXED_NOW,
        randomId: () => "receipt-a",
      }),
      executeAgentTrade({
        agent,
        input: { quoteId: quote.quoteId, idempotencyKey: "idem-b" },
        quoteStore,
        idempotencyStore,
        receipts,
        ua,
        balance: FUNDED_BALANCE,
        spendLedger,
        now: () => FIXED_NOW,
        randomId: () => "receipt-b",
      }),
    ]);

    const successes = [a, b].filter((result) => result.ok);
    const failures = [a, b].filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code: "quote_mismatch" });
    expect(executeCalls).toBe(1);
  });

  it("rejects spends above the per-trade limit", async () => {
    const agent = testAgent({ maxTradeUsd: 5, spendBudgetUsd: 100 });
    // Quote path allows research above limits; execute must enforce.
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
    const quoteStore = new MemoryAgentQuoteStore();
    const quote = await issueTradeQuote({
      agent,
      body: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
      ua,
      store: quoteStore,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
      randomId: () => "33333333-3333-4333-8333-333333333333",
    });

    const result = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-max" },
      quoteStore,
      idempotencyStore: new MemoryAgentIdempotencyStore(),
      receipts: new MemoryAgentReceiptPersist(),
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "spend_limit_exceeded",
    });
  });

  it("rejects insufficient balance before any fund movement", async () => {
    const { agent, ua, quoteStore, idempotencyStore, receipts, quote } =
      await quoteAndStores({});

    const result = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-balance" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: { totalUsd: 1, sources: [] },
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "insufficient_balance",
    });
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(false);
  });

  it("survives process restart via durable idempotency and receipt stores", async () => {
    const { agent, ua, quoteStore, quote } = await quoteAndStores({});
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();

    const first = await executeAgentTrade({
      agent,
      input: { quoteId: quote.quoteId, idempotencyKey: "idem-restart" },
      quoteStore,
      idempotencyStore,
      receipts,
      ua,
      balance: FUNDED_BALANCE,
      now: () => FIXED_NOW,
      randomId: () => "mock-receipt-restart",
    });

    const restartedIdempotency = new MemoryAgentIdempotencyStore();
    await restartedIdempotency.importAll(
      JSON.parse(JSON.stringify(idempotencyStore.exportAll())) as ReturnType<
        MemoryAgentIdempotencyStore["exportAll"]
      >,
    );

    const second = await executeAgentTrade({
      agent: testAgent({
        actionPolicy: { trade: false, back: false, publish: false },
      }),
      input: { quoteId: "missing", idempotencyKey: "idem-restart" },
      quoteStore: new MemoryAgentQuoteStore(),
      idempotencyStore: restartedIdempotency,
      receipts: new MemoryAgentReceiptPersist(),
      ua: new MockUAClient({ simulateStaleQuote: true }),
      balance: { totalUsd: 0, sources: [] },
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });

    expect(second).toEqual(first);
  });

  it("does not import Particle or the NL intent parser", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/agent-execute.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/particle/i);
    expect(source).not.toMatch(/parseIntent|from \"@\/lib\/verbs\/intent\"/);
  });
});
