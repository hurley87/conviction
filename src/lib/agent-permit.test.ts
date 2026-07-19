import { describe, expect, it } from "vitest";
import { Wallet, getBytes } from "ethers";

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
import { MemoryExecutionFinalityStore } from "@/lib/agent-execution-finality";
import { createSignedTradeSender } from "@/lib/agent-permit-send";
import {
  MemoryAgentQuoteStore,
  issueTradeQuote,
} from "@/lib/agent-quote";
import type { OwnedAgent } from "@/lib/agent-provisioning";
import { MockUAClient } from "@/lib/ua/mock";
import type { RawTransaction } from "@/lib/ua/trade";
import type { UniversalBalance } from "@/lib/verbs/types";

const FIXED_NOW = new Date("2026-07-17T12:00:00.000Z");

const FUNDED_BALANCE: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

function testAgent(
  wallet: Wallet,
  overrides: Partial<OwnedAgent> = {},
): OwnedAgent {
  return {
    agentId: "00000000-0000-4000-8000-000000000056",
    ownerUserId: "did:privy:owner-permit",
    handle: "permit-scout",
    authorKind: "agent",
    operatorHandle: "operator",
    address: wallet.address,
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
    disabledAt: null,
    retirementStartedAt: null,
    retiredAt: null,
    ...overrides,
  };
}

const VALID_ROOT_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function quoteFixture(options: {
  wallet: Wallet;
  agent?: OwnedAgent;
  sizeUsd?: number;
}) {
  const agent = options.agent ?? testAgent(options.wallet);
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
  // Mock UA rootHashes are not 32-byte digests; normalize for signer tests.
  const stored = await quoteStore.get(quote.quoteId);
  if (!stored) throw new Error("missing quote");
  const raw = (stored.rawTransaction ?? {}) as Record<string, unknown>;
  await quoteStore.save({
    ...stored,
    rawTransaction: { ...raw, rootHash: VALID_ROOT_HASH },
  });
  return { agent, quoteStore, quote };
}

async function signPermitRoot(
  wallet: Wallet,
  rawTransaction: unknown,
): Promise<string> {
  const raw = rawTransaction as RawTransaction;
  if (!raw.rootHash) throw new Error("missing rootHash");
  return wallet.signMessage(getBytes(raw.rootHash));
}

describe("issueTradeExecutionPermit + submitSignedTradeExecution", () => {
  it("issues a permit bound to the quote, then completes after local signatures", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
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

    const rootHashSignature = await signPermitRoot(
      wallet,
      permit.rawTransaction,
    );
    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-permit-1",
        leaseId: "lease-1",
        rootHashSignature,
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      onSpend: (dollarsIn) => {
        spent += dollarsIn;
      },
      randomId: () => "live-receipt-001",
      send: async ({ receiptSlug, agreedQuote }) => ({
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

  it("checks lease before returning a prior idempotent success", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-lease-first",
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
        idempotencyKey: "idem-lease-first",
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
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
    expect(first.ok).toBe(true);

    const displaced = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-lease-first",
      leaseId: "lease-stale",
      activeLeaseId: "lease-current",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    expect(displaced).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(displaced)).not.toContain("rawTransaction");
  });

  it("does not return an issued permit's rawTransaction to a displaced lease", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-open-permit",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    expect(permit.ok).toBe(true);

    const displaced = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-open-permit",
      leaseId: "lease-stale",
      activeLeaseId: "lease-current",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    expect(displaced).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("releases spend when an issued permit expires before submit", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-expired",
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
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(quote.dollarsIn);

    const expired = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-expired",
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => new Date(FIXED_NOW.getTime() + 60_000),
      send: async () => {
        throw new Error("should not send");
      },
    });

    expect(expired).toMatchObject({ ok: false, code: "quote_expired" });
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
    expect((await permitStore.get(permit.permitId))?.status).toBe("released");
  });

  it("lets success overwrite a racing failure in the idempotency store", async () => {
    const store = new MemoryAgentIdempotencyStore();
    await store.save("agent-1", "idem-race", {
      ok: false,
      code: "quote_mismatch",
      message: "loser",
    });
    await store.save("agent-1", "idem-race", {
      ok: true,
      receiptId: "rcpt",
      quoteId: "q",
      quoteFingerprint: "fp",
      transactionId: "tx",
      summary: "Done",
      receipt: {
        slug: "rcpt",
        summary: "Done",
        dollarsIn: 1,
        dollarsOut: 1,
        feeUsd: 0,
        legs: [],
      },
      dollarsIn: 1,
      dollarsOut: 1,
      feeUsd: 0,
      idempotencyKey: "idem-race",
    });
    const stored = await store.get("agent-1", "idem-race");
    expect(stored).toMatchObject({ ok: true, receiptId: "rcpt" });

    await store.save("agent-1", "idem-race", {
      ok: false,
      code: "unavailable",
      message: "should not overwrite success",
    });
    expect(await store.get("agent-1", "idem-race")).toMatchObject({
      ok: true,
      receiptId: "rcpt",
    });
  });

  it("persists success even when post-send accounting fails", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-post-send",
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

    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-post-send",
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      onSpend: () => {
        throw new Error("lifetime write failed");
      },
      send: async ({ receiptSlug, agreedQuote }) => ({
        transactionId: "tx-ok",
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

    expect(result).toMatchObject({ ok: true, transactionId: "tx-ok" });
    expect(await idempotencyStore.get(agent.agentId, "idem-post-send")).toMatchObject({
      ok: true,
    });
    expect((await permitStore.get(permit.permitId))?.status).toBe("pending");
  });

  it("rejects submit without the active lease", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-submit-lease",
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

    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-submit-lease",
        leaseId: "lease-stale",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      send: async () => {
        throw new Error("should not send");
      },
    });
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect((await permitStore.get(permit.permitId))?.status).toBe("issued");
  });

  it("records pending when submission is uncertain and blocks reuse", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
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
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
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
    expect((await permitStore.get(permit.permitId))?.status).toBe("pending");
  });

  it("reuses the pre-bound execution after provider acceptance times out", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();
    const executionStore = new MemoryExecutionFinalityStore();
    let sends = 0;
    let workflowStarts = 0;

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-finality-timeout",
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

    const common = {
      agent,
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      executionFinalityStore: executionStore,
      executionWorkflow: {
        async start(executionId: string) {
          workflowStarts += 1;
          return { runId: `run_${executionId}` };
        },
      },
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      randomId: () => "80000000-0000-4000-8000-000000000083",
      send: async () => {
        sends += 1;
        throw new Error("timeout after Particle accepted the payload");
      },
    };
    const first = await submitSignedTradeExecution({
      ...common,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-finality-timeout",
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
    });
    expect(first).toMatchObject({
      ok: false,
      code: "pending",
      outcome: "pending",
      execution: {
        outcome: "pending",
        transactionId: permit.transactionId,
      },
    });

    const permitRetry = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-finality-timeout",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      executionFinalityStore: executionStore,
      executionWorkflow: common.executionWorkflow,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    expect(permitRetry).toMatchObject({
      ok: false,
      execution: {
        executionId: "80000000-0000-4000-8000-000000000083",
      },
    });
    expect(JSON.stringify(permitRetry)).not.toContain("rawTransaction");

    const retry = await submitSignedTradeExecution({
      ...common,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-finality-timeout",
        leaseId: "lease-1",
        rootHashSignature: "",
      },
    });
    expect(retry).toMatchObject({
      ok: false,
      execution: {
        executionId: "80000000-0000-4000-8000-000000000083",
        outcome: "pending",
      },
    });
    expect(sends).toBe(1);
    expect(workflowStarts).toBe(1);
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(quote.dollarsIn);
    expect(await idempotencyStore.get(agent.agentId, "idem-finality-timeout")).toBeNull();
  });

  it("submits at most once across concurrent and repeated calls", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();
    const executionStore = new MemoryExecutionFinalityStore();
    let sends = 0;
    let settledSpend = 0;

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-finality-concurrent",
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
    const signature = await signPermitRoot(wallet, permit.rawTransaction);
    const submit = () =>
      submitSignedTradeExecution({
        agent,
        input: {
          permitId: permit.permitId,
          idempotencyKey: "idem-finality-concurrent",
          leaseId: "lease-1",
          rootHashSignature: signature,
        },
        permitStore,
        idempotencyStore,
        receipts,
        quoteStore,
        spendLedger,
        onSpend: (dollarsIn) => {
          settledSpend += dollarsIn;
        },
        executionFinalityStore: executionStore,
        executionWorkflow: {
          async start(executionId) {
            return { runId: `run_${executionId}` };
          },
        },
        activeLeaseId: "lease-1",
        now: () => FIXED_NOW,
        randomId: () => "90000000-0000-4000-8000-000000000083",
        send: async () => {
          sends += 1;
          await Promise.resolve();
          return { transactionId: permit.transactionId };
        },
      });

    const results = await Promise.all([submit(), submit(), submit()]);
    expect(sends).toBe(1);
    expect(
      results.map((result) =>
        result.ok ? null : result.execution?.executionId,
      ),
    ).toEqual([
      "90000000-0000-4000-8000-000000000083",
      "90000000-0000-4000-8000-000000000083",
      "90000000-0000-4000-8000-000000000083",
    ]);
    expect((await permitStore.get(permit.permitId))?.status).toBe("pending");
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(quote.dollarsIn);
    expect(settledSpend).toBe(0);
    expect(
      await receipts.get("90000000-0000-4000-8000-000000000083"),
    ).toBeNull();
  });

  it("rejects disabled trade before reserving spend", async () => {
    const wallet = Wallet.createRandom();
    const agent = testAgent(wallet, {
      actionPolicy: { trade: false, back: true, publish: true },
    });
    const { quoteStore, quote } = await quoteFixture({ wallet, agent });
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

  it("rejects submit and releases the permit when reloadAgent reports disabled", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-submit-disabled",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
      randomId: () => "66666666-6666-4666-8666-666666666666",
    });
    expect(permit.ok).toBe(true);
    if (!permit.ok || !("permitId" in permit)) {
      throw new Error("expected permit");
    }

    const rootHashSignature = await signPermitRoot(
      wallet,
      permit.rawTransaction,
    );
    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-submit-disabled",
        leaseId: "lease-1",
        rootHashSignature,
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      reloadAgent: async () =>
        testAgent(wallet, {
          agentId: agent.agentId,
          status: "disabled",
          publicStatus: "paused",
        }),
      send: async () => {
        throw new Error("send must not run after lifecycle block");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "lifecycle_blocked",
    });
    expect((await permitStore.get(permit.permitId))?.status).toBe("released");
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
    expect(
      await idempotencyStore.get(agent.agentId, "idem-submit-disabled"),
    ).toBeNull();
  });

  it("rejects submit when reloadAgent reports trade action disabled", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({ wallet });
    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();

    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-submit-action-off",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
      randomId: () => "77777777-7777-4777-8777-777777777777",
    });
    expect(permit.ok).toBe(true);
    if (!permit.ok || !("permitId" in permit)) {
      throw new Error("expected permit");
    }

    const rootHashSignature = await signPermitRoot(
      wallet,
      permit.rawTransaction,
    );
    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-submit-action-off",
        leaseId: "lease-1",
        rootHashSignature,
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      reloadAgent: async () =>
        testAgent(wallet, {
          agentId: agent.agentId,
          actionPolicy: { trade: false, back: true, publish: true },
        }),
      send: async () => {
        throw new Error("send must not run after action_disabled");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "action_disabled",
      action: "trade",
    });
    expect((await permitStore.get(permit.permitId))?.status).toBe("released");
  });

  it("rejects an oversized stored Particle debit before submission", async () => {
    const send = createSignedTradeSender(
      "0x1111111111111111111111111111111111111111",
      { allowMock: true },
    );

    await expect(
      send({
        rawTransaction: {
          rootHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenChanges: { totalDecrAmountInUSD: "5.00" },
        },
        rootHashSignature: "0xsig",
        agreedQuote: {
          dollarsIn: 1,
          dollarsOut: 0.995,
          feeUsd: 0.005,
          etaSeconds: 1,
          floorUsd: 0.985,
          sourceChain: "Base",
          destChain: "Base",
          toAsset: "eth",
          transactionId: "tx-oversized",
          rawTransaction: {},
        },
        intent: {
          toAsset: "eth",
          fromAsset: "usdc",
          destChain: "Base",
        },
        sizeUsd: 1,
        receiptSlug: "r-oversized",
      }),
    ).rejects.toThrow(/debit \$5\.00 exceeds the agreed ceiling of \$1\.01/i);
  });

  it("releases the permit reservation when stored debit validation fails", async () => {
    const wallet = Wallet.createRandom();
    const { agent, quoteStore, quote } = await quoteFixture({
      wallet,
      sizeUsd: 1,
    });
    const stored = await quoteStore.get(quote.quoteId);
    if (!stored) throw new Error("missing quote");
    await quoteStore.save({
      ...stored,
      rawTransaction: {
        ...(stored.rawTransaction as RawTransaction),
        rootHash: VALID_ROOT_HASH,
        tokenChanges: { totalDecrAmountInUSD: "5.00" },
      },
    });

    const permitStore = new MemoryAgentPermitStore();
    const idempotencyStore = new MemoryAgentIdempotencyStore();
    const receipts = new MemoryAgentReceiptPersist();
    const spendLedger = new MemorySpendLedger();
    const permit = await issueTradeExecutionPermit({
      agent,
      quoteId: quote.quoteId,
      idempotencyKey: "idem-oversized-debit",
      leaseId: "lease-1",
      activeLeaseId: "lease-1",
      quoteStore,
      permitStore,
      idempotencyStore,
      balance: FUNDED_BALANCE,
      spendLedger,
      now: () => FIXED_NOW,
    });
    if (!permit.ok || !("permitId" in permit)) {
      throw new Error("expected permit");
    }
    let didSend = false;

    const result = await submitSignedTradeExecution({
      agent,
      input: {
        permitId: permit.permitId,
        idempotencyKey: "idem-oversized-debit",
        leaseId: "lease-1",
        rootHashSignature: await signPermitRoot(wallet, permit.rawTransaction),
      },
      permitStore,
      idempotencyStore,
      receipts,
      quoteStore,
      spendLedger,
      activeLeaseId: "lease-1",
      now: () => FIXED_NOW,
      send: async () => {
        didSend = true;
        throw new Error("oversized payload must not be sent");
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "quote_mismatch",
      quoteId: quote.quoteId,
    });
    expect(didSend).toBe(false);
    expect((await permitStore.get(permit.permitId))?.status).toBe("released");
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
  });

  it("fails closed when Particle is missing unless mock submit is allowed", async () => {
    const previous = {
      projectId: process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID,
      clientKey: process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY,
      appId: process.env.NEXT_PUBLIC_PARTICLE_APP_ID,
    };
    delete process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
    delete process.env.NEXT_PUBLIC_PARTICLE_APP_ID;

    try {
      const closed = createSignedTradeSender(
        "0x1111111111111111111111111111111111111111",
      );
      await expect(
        closed({
          rawTransaction: {
            rootHash:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            tokenChanges: { totalDecrAmountInUSD: "1.00" },
          },
          rootHashSignature: "0xsig",
          agreedQuote: {
            dollarsIn: 1,
            dollarsOut: 1,
            feeUsd: 0,
            etaSeconds: 1,
            floorUsd: 1,
            sourceChain: "Base",
            destChain: "Arbitrum",
            toAsset: "eth",
            transactionId: "tx",
            rawTransaction: {},
          },
          intent: { toAsset: "eth", destChain: "Arbitrum" },
          sizeUsd: 1,
          receiptSlug: "r1",
        }),
      ).rejects.toThrow(/Particle is not configured/i);

      const mock = createSignedTradeSender(
        "0x1111111111111111111111111111111111111111",
        { allowMock: true },
      );
      const result = await mock({
        rawTransaction: {
          rootHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tokenChanges: { totalDecrAmountInUSD: "20.00" },
          userOps: [{ chainId: 42161, userOpHash: "0xop" }],
        },
        rootHashSignature: "0xsig",
        agreedQuote: {
          dollarsIn: 20,
          dollarsOut: 19.9,
          feeUsd: 0.1,
          etaSeconds: 1,
          floorUsd: 19.7,
          sourceChain: "Base",
          destChain: "Arbitrum",
          toAsset: "eth",
          transactionId: "tx",
          rawTransaction: {},
        },
        intent: { toAsset: "eth", destChain: "Arbitrum" },
        sizeUsd: 20,
        receiptSlug: "r-mock",
      });
      expect(result).toMatchObject({ transactionId: "tx" });
      expect(result.receipt).toBeUndefined();
    } finally {
      if (previous.projectId) {
        process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID = previous.projectId;
      }
      if (previous.clientKey) {
        process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY = previous.clientKey;
      }
      if (previous.appId) {
        process.env.NEXT_PUBLIC_PARTICLE_APP_ID = previous.appId;
      }
    }
  });
});
