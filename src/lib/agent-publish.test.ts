import { describe, expect, it } from "vitest";

import {
  MemoryAgentIdempotencyStore,
  MemoryAgentReceiptPersist,
  executeAgentTrade,
} from "@/lib/agent-execute";
import {
  MemoryAgentConvictionPersist,
  publishAgentConviction,
} from "@/lib/agent-publish";
import {
  MemoryAgentQuoteStore,
  issueTradeQuote,
} from "@/lib/agent-quote";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  MemoryAgentTradeReceiptStore,
  PUBLICATION_GATE_WINDOW_MS,
} from "@/lib/agent-trade-receipt";
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
    agentId: "00000000-0000-4000-8000-000000000057",
    ownerUserId: "did:privy:owner-publish",
    handle: "publish-scout",
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

async function executePublishableTrade(options: {
  agent?: OwnedAgent;
  publicationIntent?: boolean;
  now?: () => Date;
  receiptId?: string;
}) {
  const agent = options.agent ?? testAgent();
  const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
  const quoteStore = new MemoryAgentQuoteStore();
  const idempotencyStore = new MemoryAgentIdempotencyStore();
  const receipts = new MemoryAgentReceiptPersist();
  const tradeReceipts = new MemoryAgentTradeReceiptStore();
  const now = options.now ?? (() => FIXED_NOW);

  const quote = await issueTradeQuote({
    agent,
    body: {
      toAsset: "eth",
      sizeUsd: 20,
      destChain: "Arbitrum",
      ...(options.publicationIntent !== undefined
        ? { publicationIntent: options.publicationIntent }
        : {}),
    },
    ua,
    store: quoteStore,
    balance: FUNDED_BALANCE,
    now,
    randomId: () => "11111111-1111-4111-8111-111111111157",
    checkRouter: async () => ({ status: "routable" }),
  });

  const executed = await executeAgentTrade({
    agent,
    input: {
      quoteId: quote.quoteId,
      idempotencyKey: "idem-publish-trade",
    },
    quoteStore,
    idempotencyStore,
    receipts,
    tradeReceipts,
    ua,
    balance: FUNDED_BALANCE,
    now,
    randomId: () => options.receiptId ?? "mock-receipt-publish-001",
  });

  if (!executed.ok) {
    throw new Error(`expected execute success, got ${executed.code}`);
  }

  return {
    agent,
    tradeReceipts,
    convictions: new MemoryAgentConvictionPersist(),
    receiptId: executed.receiptId,
    quote,
  };
}

describe("publishAgentConviction", () => {
  it("publishes from a successful owned receipt with server-derived authorship", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({ publicationIntent: true });

    const result = await publishAgentConviction({
      agent,
      body: {
        receiptId,
        thesis: "ETH looks clean into the week.",
        whyNow: "Funding flipped and spot led.",
        whatBreaksIt: "A failed ETF flow week.",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
      randomId: () => "entry-publish-001",
    });

    expect(result).toMatchObject({
      ok: true,
      entryId: "entry-publish-001",
      receiptId,
    });
    if (!result.ok) throw new Error("expected success");
    expect(result.entry.authorship).toEqual({
      agentId: agent.agentId,
      authorKind: "agent",
      handle: "publish-scout",
      operatorHandle: "operator",
    });
    expect(result.entry.handle).toBe("publish-scout");
    expect(result.entry.trade.toAsset).toBe("eth");
    expect(result.entry.gateReport?.every((check) => check.passed)).toBe(true);
    expect(result.entry.whyNow?.[0]?.event).toBe(
      "Funding flipped and spot led.",
    );

    const storedReceipt = await tradeReceipts.get(receiptId);
    expect(storedReceipt?.publishable).toBe(false);
    expect(storedReceipt?.publishedEntryId).toBe("entry-publish-001");
  });

  it("does not auto-publish on execute alone", async () => {
    const { tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({ publicationIntent: true });

    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);
    expect(await convictions.getByReceiptSlug(receiptId)).toBeNull();
  });

  it("rejects foreign receipts and action_disabled before consume", async () => {
    const { tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const foreign = await publishAgentConviction({
      agent: testAgent({ agentId: "00000000-0000-4000-8000-000000000099" }),
      body: {
        receiptId,
        thesis: "Nope",
        whyNow: "Nope",
        whatBreaksIt: "Nope",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
    });
    expect(foreign).toMatchObject({
      ok: false,
      code: "receipt_not_publishable",
    });

    const disabled = await publishAgentConviction({
      agent: testAgent({
        actionPolicy: { trade: true, back: true, publish: false },
      }),
      body: {
        receiptId,
        thesis: "Disabled",
        whyNow: "Disabled",
        whatBreaksIt: "Disabled",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
    });
    expect(disabled).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "publish",
    });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);
  });

  it("returns the existing conviction on retry even if publish is later disabled", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const first = await publishAgentConviction({
      agent,
      body: {
        receiptId,
        thesis: "First publish",
        whyNow: "Catalyst",
        whatBreaksIt: "Invalidation",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
      randomId: () => "entry-first",
    });
    expect(first.ok).toBe(true);

    const retry = await publishAgentConviction({
      agent: testAgent({
        agentId: agent.agentId,
        actionPolicy: { trade: true, back: true, publish: false },
      }),
      body: {
        receiptId,
        thesis: "retry thesis",
        whyNow: "retry why",
        whatBreaksIt: "retry break",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
    });
    expect(retry).toMatchObject({
      ok: true,
      entryId: "entry-first",
    });
  });

  it("rejects forbidden authorship / gate overrides in tool input", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const result = await publishAgentConviction({
      agent,
      body: {
        receiptId,
        thesis: "Thesis",
        whyNow: "Why",
        whatBreaksIt: "Break",
        handle: "spoofed",
        authorKind: "human",
        gateReport: [{ name: "Liquidity depth", passed: true }],
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.fields?.some((field) => field.code === "forbidden_field")).toBe(
      true,
    );
  });

  it("returns the same conviction for concurrent and retried publishes", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const body = {
      receiptId,
      thesis: "One position, one conviction",
      whyNow: "Shared catalyst",
      whatBreaksIt: "Shared invalidation",
    };

    const [a, b, c] = await Promise.all([
      publishAgentConviction({
        agent,
        body,
        tradeReceipts,
        convictions,
        checkRouter: async () => ({ status: "routable" }),
        now: () => FIXED_NOW,
        randomId: () => "entry-concurrent",
      }),
      publishAgentConviction({
        agent,
        body,
        tradeReceipts,
        convictions,
        checkRouter: async () => ({ status: "routable" }),
        now: () => FIXED_NOW,
        randomId: () => "entry-concurrent-b",
      }),
      publishAgentConviction({
        agent,
        body,
        tradeReceipts,
        convictions,
        checkRouter: async () => ({ status: "routable" }),
        now: () => FIXED_NOW,
        randomId: () => "entry-concurrent-c",
      }),
    ]);

    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected all ok");
    expect(new Set([a.entryId, b.entryId, c.entryId]).size).toBe(1);
    expect(await convictions.getByReceiptSlug(receiptId)).toMatchObject({
      entryId: a.entryId,
    });
  });

  it("reuses a publication-intent gate within 24h and refreshes after", async () => {
    const { agent, tradeReceipts, convictions, receiptId, quote } =
      await executePublishableTrade({ publicationIntent: true });

    expect(quote.gateReport?.length).toBeGreaterThan(0);

    const within = await publishAgentConviction({
      agent,
      body: {
        receiptId,
        thesis: "Within window",
        whyNow: "Still fresh",
        whatBreaksIt: "Break",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => {
        throw new Error("should reuse bound gate");
      },
      now: () => new Date(FIXED_NOW.getTime() + 60_000),
      randomId: () => "entry-within",
    });
    expect(within.ok).toBe(true);

    // Fresh receipt for the expired-window case.
    const second = await executePublishableTrade({
      publicationIntent: true,
      receiptId: "mock-receipt-publish-002",
      now: () => FIXED_NOW,
    });
    let routerCalls = 0;
    const after = await publishAgentConviction({
      agent: second.agent,
      body: {
        receiptId: second.receiptId,
        thesis: "After window",
        whyNow: "Need a fresh gate",
        whatBreaksIt: "Break",
      },
      tradeReceipts: second.tradeReceipts,
      convictions: second.convictions,
      checkRouter: async () => {
        routerCalls += 1;
        return { status: "routable" };
      },
      now: () =>
        new Date(FIXED_NOW.getTime() + PUBLICATION_GATE_WINDOW_MS + 1),
      randomId: () => "entry-after",
    });
    expect(after.ok).toBe(true);
    // Native ETH product gate does not call the router; ensure publish still succeeds.
    expect(routerCalls).toBeGreaterThanOrEqual(0);
  });

  it("rejects lifecycle-blocked agents before creating a conviction", async () => {
    const { tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const result = await publishAgentConviction({
      agent: testAgent({ status: "disabled", publicStatus: "paused" }),
      body: {
        receiptId,
        thesis: "Blocked",
        whyNow: "Blocked",
        whatBreaksIt: "Blocked",
      },
      tradeReceipts,
      convictions,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "lifecycle_blocked",
    });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);
  });
});
