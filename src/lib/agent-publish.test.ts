import { describe, expect, it } from "vitest";

import {
  MemoryAgentIdempotencyStore,
  MemoryAgentReceiptPersist,
  executeAgentTrade,
} from "@/lib/agent-execute";
import {
  MemoryAgentConvictionPersist,
  publishAgentConviction,
  type AgentPublishResult,
} from "@/lib/agent-publish";
import {
  MemoryAgentQuoteStore,
  issueTradeQuote,
} from "@/lib/agent-quote";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import {
  MemoryAgentTradeReceiptStore,
  PUBLICATION_GATE_WINDOW_MS,
  buildAgentTradeReceiptRecord,
} from "@/lib/agent-trade-receipt";
import { MockUAClient } from "@/lib/ua/mock";
import type { UniversalBalance } from "@/lib/verbs/types";

const FIXED_NOW = new Date("2026-07-17T12:00:00.000Z");
const LEASE = {
  leaseId: "lease-publish",
  activeLeaseId: "lease-publish" as string | null,
};

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

async function publish(options: {
  agent: OwnedAgent;
  body: Record<string, unknown>;
  tradeReceipts: MemoryAgentTradeReceiptStore;
  convictions: MemoryAgentConvictionPersist;
  checkRouter?: () => Promise<{ status: "routable" | "no_route" }>;
  now?: () => Date;
  randomId?: () => string;
  leaseId?: string;
  activeLeaseId?: string | null;
}): Promise<AgentPublishResult> {
  return publishAgentConviction({
    agent: options.agent,
    body: options.body,
    tradeReceipts: options.tradeReceipts,
    convictions: options.convictions,
    leaseId: options.leaseId ?? LEASE.leaseId,
    activeLeaseId:
      options.activeLeaseId !== undefined
        ? options.activeLeaseId
        : LEASE.activeLeaseId,
    checkRouter:
      options.checkRouter ?? (async () => ({ status: "routable" as const })),
    now: options.now ?? (() => FIXED_NOW),
    ...(options.randomId ? { randomId: options.randomId } : {}),
  });
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

    const result = await publish({
      agent,
      body: {
        receiptId,
        thesis: "ETH looks clean into the week.",
        whyNow: "Funding flipped and spot led.",
        whatBreaksIt: "A failed ETF flow week.",
      },
      tradeReceipts,
      convictions,
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

    const foreign = await publish({
      agent: testAgent({ agentId: "00000000-0000-4000-8000-000000000099" }),
      body: {
        receiptId,
        thesis: "Nope",
        whyNow: "Nope",
        whatBreaksIt: "Nope",
      },
      tradeReceipts,
      convictions,
    });
    expect(foreign).toMatchObject({
      ok: false,
      code: "receipt_not_publishable",
    });

    const disabled = await publish({
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
    });
    expect(disabled).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "publish",
    });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);
  });

  it("rejects a missing or stale MCP lease before reading publish results", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const lost = await publish({
      agent,
      body: {
        receiptId,
        thesis: "Lease lost",
        whyNow: "Lease lost",
        whatBreaksIt: "Lease lost",
      },
      tradeReceipts,
      convictions,
      activeLeaseId: null,
    });
    expect(lost).toMatchObject({ ok: false, code: "unavailable" });

    const mismatched = await publish({
      agent,
      body: {
        receiptId,
        thesis: "Wrong lease",
        whyNow: "Wrong lease",
        whatBreaksIt: "Wrong lease",
      },
      tradeReceipts,
      convictions,
      leaseId: "lease-a",
      activeLeaseId: "lease-b",
    });
    expect(mismatched).toMatchObject({ ok: false, code: "unavailable" });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);
  });

  it("returns the existing conviction on retry even if publish is later disabled", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const first = await publish({
      agent,
      body: {
        receiptId,
        thesis: "First publish",
        whyNow: "Catalyst",
        whatBreaksIt: "Invalidation",
      },
      tradeReceipts,
      convictions,
      randomId: () => "entry-first",
    });
    expect(first.ok).toBe(true);

    const retry = await publish({
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
    });
    expect(retry).toMatchObject({
      ok: true,
      entryId: "entry-first",
    });
  });

  it("rejects forbidden authorship / gate overrides in tool input", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const result = await publish({
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
      publish({
        agent,
        body,
        tradeReceipts,
        convictions,
        randomId: () => "entry-concurrent",
      }),
      publish({
        agent,
        body,
        tradeReceipts,
        convictions,
        randomId: () => "entry-concurrent-b",
      }),
      publish({
        agent,
        body,
        tradeReceipts,
        convictions,
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

  it("rolls back consume when conviction save fails so publish can retry", async () => {
    const { agent, tradeReceipts, receiptId } = await executePublishableTrade(
      {},
    );
    let failOnce = true;
    const convictions = new MemoryAgentConvictionPersist();
    const flaky = {
      save: async (entry: Parameters<MemoryAgentConvictionPersist["save"]>[0]) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("neon write failed");
        }
        await convictions.save(entry);
      },
      get: (entryId: string) => convictions.get(entryId),
      getByReceiptSlug: (slug: string) => convictions.getByReceiptSlug(slug),
    };

    const first = await publishAgentConviction({
      agent,
      body: {
        receiptId,
        thesis: "Retryable thesis",
        whyNow: "Retryable why",
        whatBreaksIt: "Retryable break",
      },
      tradeReceipts,
      convictions: flaky,
      leaseId: LEASE.leaseId,
      activeLeaseId: LEASE.activeLeaseId,
      checkRouter: async () => ({ status: "routable" }),
      now: () => FIXED_NOW,
      randomId: () => "entry-retryable",
    });
    expect(first).toMatchObject({ ok: false, code: "unavailable" });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);

    const second = await publish({
      agent,
      body: {
        receiptId,
        thesis: "Retryable thesis",
        whyNow: "Retryable why",
        whatBreaksIt: "Retryable break",
      },
      tradeReceipts,
      convictions,
      randomId: () => "entry-retryable",
    });
    expect(second).toMatchObject({ ok: true, entryId: "entry-retryable" });
  });

  it("never un-consumes a published receipt when execute re-saves it", async () => {
    const { agent, tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const published = await publish({
      agent,
      body: {
        receiptId,
        thesis: "Published once",
        whyNow: "Once",
        whatBreaksIt: "Once",
      },
      tradeReceipts,
      convictions,
      randomId: () => "entry-once",
    });
    expect(published.ok).toBe(true);

    const before = await tradeReceipts.get(receiptId);
    expect(before?.publishable).toBe(false);

    await tradeReceipts.save(
      buildAgentTradeReceiptRecord({
        agentId: agent.agentId,
        receipt: before!.receipt,
        entryAt: before!.entryAt,
        quoteId: before!.quoteId,
        quoteFingerprint: before!.quoteFingerprint,
        intent: before!.intent,
        sizeUsd: before!.sizeUsd,
        dollarsIn: before!.dollarsIn,
        dollarsOut: before!.dollarsOut,
        feeUsd: before!.feeUsd,
        sourceChain: before!.sourceChain,
        destChain: before!.destChain,
        toAsset: before!.toAsset,
        publicationIntent: false,
      }),
    );

    const after = await tradeReceipts.get(receiptId);
    expect(after?.publishable).toBe(false);
    expect(after?.publishedEntryId).toBe("entry-once");

    const retry = await publish({
      agent,
      body: {
        receiptId,
        thesis: "Second attempt",
        whyNow: "Should not create another",
        whatBreaksIt: "Nope",
      },
      tradeReceipts,
      convictions,
      randomId: () => "entry-twice",
    });
    expect(retry).toMatchObject({ ok: true, entryId: "entry-once" });
  });

  it("reuses a publication-intent gate within 24h and refreshes after", async () => {
    const { agent, tradeReceipts, convictions, receiptId, quote } =
      await executePublishableTrade({ publicationIntent: true });

    expect(quote.gateReport?.length).toBeGreaterThan(0);

    const within = await publish({
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

    const second = await executePublishableTrade({
      publicationIntent: true,
      receiptId: "mock-receipt-publish-002",
      now: () => FIXED_NOW,
    });
    const after = await publish({
      agent: second.agent,
      body: {
        receiptId: second.receiptId,
        thesis: "After window",
        whyNow: "Need a fresh gate",
        whatBreaksIt: "Break",
      },
      tradeReceipts: second.tradeReceipts,
      convictions: second.convictions,
      now: () =>
        new Date(FIXED_NOW.getTime() + PUBLICATION_GATE_WINDOW_MS + 1),
      randomId: () => "entry-after",
    });
    expect(after.ok).toBe(true);
  });

  it("rejects lifecycle-blocked agents and missing receipts", async () => {
    const { tradeReceipts, convictions, receiptId } =
      await executePublishableTrade({});

    const blocked = await publish({
      agent: testAgent({ status: "disabled", publicStatus: "paused" }),
      body: {
        receiptId,
        thesis: "Blocked",
        whyNow: "Blocked",
        whatBreaksIt: "Blocked",
      },
      tradeReceipts,
      convictions,
    });
    expect(blocked).toMatchObject({
      ok: false,
      code: "lifecycle_blocked",
    });
    expect((await tradeReceipts.get(receiptId))?.publishable).toBe(true);

    const missing = await publish({
      agent: testAgent(),
      body: {
        receiptId: "does-not-exist",
        thesis: "Thesis only is rejected",
        whyNow: "No receipt",
        whatBreaksIt: "No receipt",
      },
      tradeReceipts,
      convictions,
    });
    expect(missing).toMatchObject({
      ok: false,
      code: "receipt_not_found",
    });
  });
});
