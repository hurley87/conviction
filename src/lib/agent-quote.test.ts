import { describe, expect, it } from "vitest";
import {
  AgentQuoteError,
  MemoryAgentQuoteStore,
  buildQuoteFingerprint,
  computeQuoteExpiresAt,
  getExecutableTradeQuote,
  issueTradeQuote,
  parseStructuredTradeQuoteInput,
  validateStructuredTradeForQuote,
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

const EMPTY_BALANCE: UniversalBalance = {
  totalUsd: 0,
  sources: [],
};

function testAgent(overrides: Partial<OwnedAgent> = {}): OwnedAgent {
  return {
    agentId: "00000000-0000-4000-8000-000000000054",
    ownerUserId: "did:privy:owner-quote",
    handle: "quote-scout",
    authorKind: "agent",
    operatorHandle: "operator",
    address: "0x1111111111111111111111111111111111111111",
    returnAddress: "0x0000000000000000000000000000000000000001",
    status: "active",
    publicStatus: "active",
    actionPolicy: { trade: false, back: true, publish: true },
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

describe("parseStructuredTradeQuoteInput", () => {
  it("accepts named product assets with sizeUsd", () => {
    expect(
      parseStructuredTradeQuoteInput({
        toAsset: "eth",
        sizeUsd: 20,
        destChain: "Arbitrum",
      }),
    ).toEqual({
      toAsset: "eth",
      sizeUsd: 20,
      destChain: "Arbitrum",
      publicationIntent: false,
    });
  });

  it("rejects caller-supplied token/contract fields via allowlist", () => {
    expect(() =>
      parseStructuredTradeQuoteInput({
        toAsset: "eth",
        sizeUsd: 20,
        token: {
          chainId: 8453,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
      }),
    ).toThrow(AgentQuoteError);

    try {
      parseStructuredTradeQuoteInput({
        toAsset: "eth",
        sizeUsd: 20,
        contractAddress: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "arbitrary_token_rejected",
      });
    }
  });

  it("rejects unknown non-token fields", () => {
    expect(() =>
      parseStructuredTradeQuoteInput({
        toAsset: "eth",
        sizeUsd: 20,
        side: "buy",
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects toAsset token sentinel", () => {
    expect(() =>
      parseStructuredTradeQuoteInput({ toAsset: "token", sizeUsd: 10 }),
    ).toThrow(expect.objectContaining({ code: "arbitrary_token_rejected" }));
  });

  it("requires exactly one of sizeUsd or fraction", () => {
    expect(() => parseStructuredTradeQuoteInput({ toAsset: "eth" })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );

    expect(() =>
      parseStructuredTradeQuoteInput({
        toAsset: "eth",
        sizeUsd: 10,
        fraction: 0.1,
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects unsupported assets", () => {
    expect(() =>
      parseStructuredTradeQuoteInput({ toAsset: "doge", sizeUsd: 10 }),
    ).toThrow(expect.objectContaining({ code: "unsupported_asset" }));
  });
});

describe("validateStructuredTradeForQuote", () => {
  it("quotes with sizeUsd even when the account is unfunded", () => {
    const result = validateStructuredTradeForQuote(
      { toAsset: "eth", sizeUsd: 15, destChain: "Arbitrum" },
      EMPTY_BALANCE,
    );
    expect(result.sizeUsd).toBe(15);
    expect(result.intent.destChain).toBe("Arbitrum");
  });

  it("requires sizeUsd when fraction is used on an empty balance", () => {
    expect(() =>
      validateStructuredTradeForQuote(
        { toAsset: "eth", fraction: 0.1 },
        EMPTY_BALANCE,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });
});

describe("computeQuoteExpiresAt", () => {
  it("caps provider expiry at 60 seconds", () => {
    const issuedAt = FIXED_NOW;
    const provider = new Date(FIXED_NOW.getTime() + 120_000);
    expect(
      computeQuoteExpiresAt({ issuedAt, providerExpiresAt: provider }),
    ).toEqual(new Date(FIXED_NOW.getTime() + 60_000));
  });

  it("honors provider expiry shorter than the cap", () => {
    const issuedAt = FIXED_NOW;
    const provider = new Date(FIXED_NOW.getTime() + 15_000);
    expect(
      computeQuoteExpiresAt({ issuedAt, providerExpiresAt: provider }),
    ).toEqual(provider);
  });

  it("applies a default lifetime when provider omits expiry", () => {
    expect(
      computeQuoteExpiresAt({ issuedAt: FIXED_NOW, providerExpiresAt: null }),
    ).toEqual(new Date(FIXED_NOW.getTime() + 60_000));
  });
});

describe("issueTradeQuote", () => {
  it("returns quoteId, expiry, costs, floor, and chain context without moving funds", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
    const beforeTrades = ua.tradeRecords.length;

    const quote = await issueTradeQuote({
      store,
      ua,
      agent: testAgent({
        actionPolicy: { trade: false, back: true, publish: true },
      }),
      body: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
      now: () => FIXED_NOW,
      randomId: () => "00000000-0000-4000-8000-00000000q001",
      balance: FUNDED_BALANCE,
    });

    expect(quote).toMatchObject({
      ok: true,
      quoteId: "00000000-0000-4000-8000-00000000q001",
      action: "trade",
      dollarsIn: 20,
      publicationIntent: false,
      destChain: "Arbitrum",
      toAsset: "eth",
      issuedAt: FIXED_NOW.toISOString(),
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
    });
    expect(quote.floorUsd).toBeCloseTo(quote.dollarsOut * 0.99, 5);
    expect(quote.feeUsd).toBeGreaterThan(0);
    expect(quote.quoteFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(quote.sourceChain).toBeTruthy();
    expect(ua.tradeRecords.length).toBe(beforeTrades + 1);
  });

  it("remains available when trading is disabled and the account is unfunded", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: [] });

    const quote = await issueTradeQuote({
      store,
      ua,
      agent: testAgent({
        actionPolicy: { trade: false, back: false, publish: false },
        fundingReady: true,
      }),
      body: { toAsset: "eth", sizeUsd: 12, destChain: "Base" },
      now: () => FIXED_NOW,
      randomId: () => "00000000-0000-4000-8000-00000000q002",
      balance: EMPTY_BALANCE,
    });

    expect(quote.ok).toBe(true);
    expect(quote.sizeUsd).toBe(12);
  });

  it("binds a passing publication gate to the quote", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });

    const quote = await issueTradeQuote({
      store,
      ua,
      agent: testAgent(),
      body: {
        toAsset: "eth",
        sizeUsd: 20,
        destChain: "Arbitrum",
        publicationIntent: true,
      },
      now: () => FIXED_NOW,
      randomId: () => "00000000-0000-4000-8000-00000000q003",
      balance: FUNDED_BALANCE,
      checkRouter: async () => ({ status: "routable" }),
    });

    expect(quote.publicationIntent).toBe(true);
    expect(quote.gateVersion).toBe("gate-v1");
    expect(quote.targetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(quote.gateReport?.every((check) => check.passed)).toBe(true);

    const stored = await store.get(quote.quoteId);
    expect(stored?.gateReport).toEqual(quote.gateReport);
    expect(stored?.targetFingerprint).toBe(quote.targetFingerprint);
  });

  it("returns gate_failed with evidence and no executable quote", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });

    await expect(
      issueTradeQuote({
        store,
        ua,
        agent: testAgent(),
        body: {
          toAsset: "usdc",
          sizeUsd: 20,
          destChain: "Arbitrum",
          publicationIntent: true,
        },
        now: () => FIXED_NOW,
        balance: FUNDED_BALANCE,
        checkRouter: async () => ({ status: "no_route" }),
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toMatchObject({
      code: "gate_failed",
      details: {
        gateReport: expect.any(Array),
        preview: expect.objectContaining({ dollarsIn: 20 }),
      },
    });

    expect(await store.get("anything")).toBeNull();
  });

  it("blocks retired agents", async () => {
    await expect(
      issueTradeQuote({
        store: new MemoryAgentQuoteStore(),
        ua: new MockUAClient(),
        agent: testAgent({ status: "retired", publicStatus: "retired" }),
        body: { toAsset: "eth", sizeUsd: 10 },
        balance: FUNDED_BALANCE,
      }),
    ).rejects.toMatchObject({ code: "lifecycle_blocked" });
  });

  it("fingerprint mismatch rejects later execution lookup", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
    const quote = await issueTradeQuote({
      store,
      ua,
      agent: testAgent(),
      body: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
      now: () => FIXED_NOW,
      randomId: () => "00000000-0000-4000-8000-00000000q004",
      balance: FUNDED_BALANCE,
    });

    await expect(
      getExecutableTradeQuote(store, {
        quoteId: quote.quoteId,
        agentId: testAgent().agentId,
        quoteFingerprint: "0".repeat(64),
        now: () => FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "quote_mismatch" });

    const ok = await getExecutableTradeQuote(store, {
      quoteId: quote.quoteId,
      agentId: testAgent().agentId,
      quoteFingerprint: quote.quoteFingerprint,
      now: () => FIXED_NOW,
    });
    expect(ok.quoteId).toBe(quote.quoteId);
  });

  it("expired quotes return quote_expired", async () => {
    const store = new MemoryAgentQuoteStore();
    const ua = new MockUAClient({ sources: FUNDED_BALANCE.sources });
    const quote = await issueTradeQuote({
      store,
      ua,
      agent: testAgent(),
      body: { toAsset: "eth", sizeUsd: 20, destChain: "Arbitrum" },
      now: () => FIXED_NOW,
      randomId: () => "00000000-0000-4000-8000-00000000q005",
      balance: FUNDED_BALANCE,
      providerExpiresAt: new Date(FIXED_NOW.getTime() + 10_000),
    });

    await expect(
      getExecutableTradeQuote(store, {
        quoteId: quote.quoteId,
        agentId: testAgent().agentId,
        quoteFingerprint: quote.quoteFingerprint,
        now: () => new Date(FIXED_NOW.getTime() + 11_000),
      }),
    ).rejects.toMatchObject({ code: "quote_expired" });
  });

  it("does not import or invoke the natural-language intent parser", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const source = await readFile(
      join(process.cwd(), "src/lib/agent-quote.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /import\s*\{[^}]*parseIntentHeuristic|from\s*["']@\/lib\/verbs\/intent-llm|from\s*["'].*parse-intent/,
    );
    expect(source).not.toMatch(/\bparseIntentHeuristic\s*\(/);
    expect(
      buildQuoteFingerprint({
        action: "trade",
        intent: { toAsset: "eth", destChain: "Arbitrum", sizeUsd: 10 },
        sizeUsd: 10,
        publicationIntent: false,
        dollarsIn: 10,
        dollarsOut: 9.9,
        feeUsd: 0.1,
        floorUsd: 9.801,
        sourceChain: "Base",
        destChain: "Arbitrum",
      }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
