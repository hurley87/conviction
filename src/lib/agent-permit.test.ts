import { describe, expect, it } from "vitest";

import {
  MemoryAgentIdempotencyStore,
  MemoryAgentReceiptPersist,
  MemorySpendLedger,
} from "@/lib/agent-execute";
import {
  MemoryAgentPermitStore,
  issueTradeExecutionPermit,
  submitSignedTradeExecution,
} from "@/lib/agent-permit";
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
    agentId: "00000000-0000-4000-8000-000000000056",
    ownerUserId: "did:privy:owner-permit",
    handle: "permit-scout",
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

async function quoteFixture(options: {
  agent?: OwnedAgent;
  sizeUsd?: number;
} = {}) {
  const agent = options.agent ?? testAgent();
  const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
  const quoteStore = new MemoryAgentQuoteStore();
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
    now: () => FIXED_NOW,
    randomId: () => "22222222-2222-4222-8222-222222222222",
  });
  return { agent, quoteStore, quote };
}

describe("issueTradeExecutionPermit + submitSignedTradeExecution", () => {
  it("issues a permit bound to the quote, then completes after local signatures", async () => {
    const { agent, quoteStore, quote } = await quoteFixture();
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();
    let spent = 0;

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-permit-1",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
      randomId: () => "33333333-3333-4333-8333-333333333333",
    });

    expect(permit).toMatchObject({
      ok: true,
      quoteId: quote.quoteId,
      quoteFingerprint: quote.quoteFingerprint,
      dollarsIn: quote.dollarsIn,
    });
    if (!permit.ok || !("permitId" in permit)) {
      throw new Error("expected permit");
    }
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(true);
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(quote.dollarsIn);

    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-permit-1",
        rootHashSignature: "0xlocalsig",
      },
      permitStore,
      idempotencyStore,
      receipts,
      spendLedger,
      now: () => FIXED_NOW,
      onSpend: (dollarsIn) => {
        spent += dollarsIn;
      },
      randomId: () => "live-receipt-001",
      send: async ({ receiptSlug, agreedQuote, intent }) => ({
        transactionId: "tx-live-1",
        summary: "Done",
        receipt: {
          slug: receiptSlug,
          summary: "Done",
          dollarsIn: agreedQuote.dollarsIn,
          dollarsOut: agreedQuote.dollarsOut,
          feeUsd: agreedQuote.feeUsd,
          legs: [
            {
              chain: agreedQuote.sourceChain,
              txHash: "0xabc",
              explorerUrl: "https://example.test/abc",
            },
            {
              chain: agreedQuote.destChain,
              txHash: "0xdef",
              explorerUrl: "https://example.test/def",
            },
          ],
        },
        // intent retained for sender contract; unused in this stub
        ...(intent ? {} : {}),
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      receiptId: "live-receipt-001",
      quoteId: quote.quoteId,
      idempotencyKey: "idem-permit-1",
    });
    expect(spent).toBe(quote.dollarsIn);
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
    expect(await receipts.get("live-receipt-001")).toMatchObject({
      receipt: { slug: "live-receipt-001" },
    });
  });

  it("returns stored idempotent success without issuing another permit", async () => {
    const { agent, quoteStore, quote } = await quoteFixture();
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-retry",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    if (!permit.ok || !("permitId" in permit)) throw new Error("expected permit");

    const first = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-retry",
        rootHashSignature: "0xlocalsig",
      },
      permitStore,
      idempotencyStore,
      receipts,
      spendLedger,
      now: () => FIXED_NOW,
      send: async ({ receiptSlug, agreedQuote }) => ({
        transactionId: "tx-1",
        summary: "Done",
        receipt: {
          slug: receiptSlug,
          summary: "Done",
          dollarsIn: agreedQuote.dollarsIn,
          dollarsOut: agreedQuote.dollarsOut,
          feeUsd: agreedQuote.feeUsd,
          legs: [],
        },
      }),
    });

    const disabled = testAgent({
      ...agent,
      actionPolicy: { trade: false, back: true, publish: true },
    });
    const second = await issueTradeExecutionPermit({
      agent: disabled,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-retry",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });

    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
  });

  it("fails closed on lease mismatch before claiming the quote", async () => {
    const { agent, quoteStore, quote } = await quoteFixture();
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const spendLedger = new MemorySpendLedger();

    const result = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-lease",
      leaseId: "lease-stale",
      activeLeaseId: "lease-current",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect((await quoteStore.get(quote.quoteId))?.used).toBe(false);
  });

  it("records pending when submission is uncertain and blocks reuse", async () => {
    const { agent, quoteStore, quote } = await quoteFixture();
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-pending",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    if (!permit.ok || !("permitId" in permit)) throw new Error("expected permit");

    const uncertain = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-pending",
        rootHashSignature: "0xlocalsig",
      },
      permitStore,
      idempotencyStore,
      receipts,
      spendLedger,
      now: () => FIXED_NOW,
      send: async () => {
        throw new Error("network timeout after broadcast");
      },
    });

    expect(uncertain).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    expect(uncertain.ok === false && uncertain.message).toMatch(/uncertain/i);

    const stored = await permitStore.get(permit.permitId);
    expect(stored?.status).toBe("pending");
  });

  it("rejects disabled trade before reserving spend", async () => {
    const agent = testAgent({
      actionPolicy: { trade: false, back: true, publish: true },
    });
    const { quoteStore, quote } = await quoteFixture({ agent });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const spendLedger = new MemorySpendLedger();

    const result = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-disabled",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "trade",
    });
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
  });
});
