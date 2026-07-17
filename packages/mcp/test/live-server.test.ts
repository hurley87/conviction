import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Wallet, verifyMessage } from "ethers";

import { LeaseHandle } from "../src/lease.js";
import { createLiveServer, LIVE_TOOLS } from "../src/live-server.js";
import type { AgentProfile } from "../src/profile.js";
import { buildAgentRequestMessage, hashRequestBody } from "../src/signed-request.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

function testProfile(wallet: Wallet): AgentProfile {
  return {
    version: 1,
    profileName: "signal-scout",
    agentId: "00000000-0000-4000-8000-000000000111",
    handle: "signal-scout",
    operatorHandle: "operator",
    signerAddress: wallet.address,
    universalAccountAddress: wallet.address,
    keystorePath: "/tmp/unused.json",
    fundingReady: true,
    actionPolicy: { trade: true, back: true, publish: false },
    maxTradeUsd: 25,
    spendBudgetUsd: 100,
    createdAt: "2026-07-17T12:00:00.000Z",
  };
}

function mockLease(wallet: Wallet): LeaseHandle {
  const now = Date.now();
  return new LeaseHandle(
    {
      leaseId: "lease-test-1",
      agentId: "00000000-0000-4000-8000-000000000111",
      expiresAt: new Date(now + 120_000).toISOString(),
      acquiredAt: new Date(now).toISOString(),
    },
    {
      apiBaseUrl: "http://conviction.test",
      wallet,
    },
  );
}

function sampleStatus(address: string) {
  return {
    ok: true,
    mode: "live",
    agentId: "00000000-0000-4000-8000-000000000111",
    handle: "signal-scout",
    operatorHandle: "operator",
    address,
    depositAddress: address,
    depositAddresses: { evm: address, solana: null },
    balance: {
      totalUsd: 242.5,
      sources: [
        { chain: "Arbitrum", asset: "USDC", usd: 180 },
        { chain: "Base", asset: "ETH", usd: 62.5 },
      ],
    },
    status: "active",
    publicStatus: "active",
    actionPolicy: { trade: true, back: true, publish: false },
    maxTradeUsd: 25,
    spendBudgetUsd: 100,
    lifetimeSpendUsd: 10,
    remainingBudgetUsd: 90,
    fundingReady: true,
    setupVerifiedAt: null,
  };
}

async function connectLiveServer(options: {
  wallet: Wallet;
  lease: LeaseHandle;
  fetchImpl: typeof fetch;
}) {
  const server = createLiveServer({
    profile: testProfile(options.wallet),
    wallet: options.wallet,
    lease: options.lease,
    apiBaseUrl: "http://conviction.test",
    fetchImpl: options.fetchImpl,
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "live-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("createLiveServer", () => {
  it("exposes the complete canonical v1 tool contract", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const client = await connectLiveServer({
      wallet,
      lease,
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...LIVE_TOOLS]);
    expect(LIVE_TOOLS).toHaveLength(10);
    expect(JSON.stringify(listed.tools)).not.toMatch(
      /signMessage|privateKey|mnemonic|keystore|authorize/i,
    );
  });

  it("returns backend-authoritative account status over a signed request", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    let sawSignedStatus = false;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(url).toBe("http://conviction.test/api/agents/status");
      expect(init?.method).toBe("GET");
      const headers = new Headers(init?.headers);
      const agent = headers.get("x-conviction-agent");
      const timestamp = headers.get("x-conviction-timestamp");
      const nonce = headers.get("x-conviction-nonce");
      const signature = headers.get("x-conviction-signature");
      expect(agent).toBe(wallet.address);
      expect(timestamp).toMatch(/^\d+$/);
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(signature).toBeTruthy();

      const message = buildAgentRequestMessage({
        method: "GET",
        path: "/api/agents/status",
        bodyHash: hashRequestBody(""),
        timestampMs: timestamp!,
        nonce: nonce!,
        agentAddress: agent!,
      });
      expect(verifyMessage(message, signature!)).toBe(wallet.address);
      sawSignedStatus = true;

      return new Response(JSON.stringify({ status: sampleStatus(wallet.address) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = await connectLiveServer({ wallet, lease, fetchImpl });
    const result = await client.callTool({
      name: "conviction_account_status",
      arguments: {},
    });

    expect(sawSignedStatus).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      mode: "live",
      handle: "signal-scout",
      remainingBudgetUsd: 90,
      balance: { totalUsd: 242.5 },
      depositAddresses: { evm: wallet.address, solana: null },
      actionPolicy: { trade: true, back: true, publish: false },
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /privateKey|mnemonic|keystore/i,
    );
  });

  it("lists, fetches, summarizes, and loads receipts through signed read tools", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const seenPaths: string[] = [];

    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;
      seenPaths.push(path);

      if (path === "/api/agents/convictions?limit=1") {
        return new Response(
          JSON.stringify({
            ok: true,
            entries: [
              {
                entryId: "entry-1",
                handle: "scout",
                thesis: "ETH looks clean.",
                trade: {
                  fromAsset: "cash",
                  toAsset: "eth",
                  sizeUsd: 20,
                  toChain: "Arbitrum",
                },
                createdAt: "2026-07-15T18:00:00.000Z",
                backerCount: 1,
                anatomy: {
                  whyNowCount: 1,
                  hasWhatBreaksIt: true,
                  gatePassed: 2,
                  gateFailed: 0,
                },
              },
            ],
            nextCursor: "cursor-2",
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (path === "/api/agents/convictions/entry-1") {
        return new Response(
          JSON.stringify({
            ok: true,
            entry: {
              entryId: "entry-1",
              handle: "scout",
              thesis: "ETH looks clean.",
              trade: {
                fromAsset: "cash",
                fromChain: "Base",
                toAsset: "eth",
                toChain: "Arbitrum",
                sizeUsd: 20,
              },
              createdAt: "2026-07-15T18:00:00.000Z",
              backedBy: ["alice"],
            },
            attribution: { backerCount: 1, backedBy: ["alice"] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (path === "/api/agents/summarize-feed") {
        return new Response(
          JSON.stringify({
            ok: true,
            digest: "1 conviction on the feed.",
            flagged: ["entry-1"],
            flaggedEntries: [
              {
                entryId: "entry-1",
                handle: "scout",
                reason: "thin rationale",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (path === "/api/agents/receipts?receiptId=receipt-1") {
        return new Response(
          JSON.stringify({
            ok: true,
            receiptId: "receipt-1",
            receipt: {
              slug: "receipt-1",
              summary: "Bought ETH",
              dollarsIn: 20,
              dollarsOut: 19.8,
              feeUsd: 0.2,
              legs: [
                {
                  chain: "Arbitrum",
                  txHash: "0xabc",
                  explorerUrl: "https://arbiscan.io/tx/0xabc",
                },
              ],
            },
            entryAt: "2026-07-15T18:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ error: { code: "unavailable", message: "miss" } }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    };

    const client = await connectLiveServer({ wallet, lease, fetchImpl });

    const listed = await client.callTool({
      name: "conviction_list_convictions",
      arguments: { limit: 1 },
    });
    expect(listed.structuredContent).toMatchObject({
      ok: true,
      hasMore: true,
      nextCursor: "cursor-2",
      entries: [{ entryId: "entry-1", backerCount: 1 }],
    });

    const one = await client.callTool({
      name: "conviction_get_conviction",
      arguments: { entryId: "entry-1" },
    });
    expect(one.structuredContent).toMatchObject({
      ok: true,
      attribution: { backedBy: ["alice"] },
      entry: { entryId: "entry-1" },
    });

    const summary = await client.callTool({
      name: "conviction_summarize_feed",
      arguments: {},
    });
    expect(summary.structuredContent).toMatchObject({
      ok: true,
      flagged: ["entry-1"],
      digest: "1 conviction on the feed.",
    });

    const receipt = await client.callTool({
      name: "conviction_get_receipt",
      arguments: { receiptId: "receipt-1" },
    });
    expect(receipt.structuredContent).toMatchObject({
      ok: true,
      receiptId: "receipt-1",
      receipt: {
        legs: [{ explorerUrl: "https://arbiscan.io/tx/0xabc" }],
      },
    });

    expect(seenPaths).toEqual([
      "/api/agents/convictions?limit=1",
      "/api/agents/convictions/entry-1",
      "/api/agents/summarize-feed",
      "/api/agents/receipts?receiptId=receipt-1",
    ]);
  });

  it("surfaces stable backend error codes from read tools", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const client = await connectLiveServer({
      wallet,
      lease,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: "Conviction not found." },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    });

    const result = await client.callTool({
      name: "conviction_get_conviction",
      arguments: { entryId: "missing" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("quotes a structured trade over a signed request and never accepts free-form fields", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    let sawQuoteRequest = false;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(url).toBe("http://conviction.test/api/agents/quote/trade");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-conviction-agent")).toBe(wallet.address);
      expect(headers.get("x-conviction-signature")).toBeTruthy();
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      expect(body).toEqual({
        toAsset: "eth",
        sizeUsd: 20,
        destChain: "Arbitrum",
      });
      expect(body).not.toHaveProperty("token");
      expect(body).not.toHaveProperty("side");
      expect(body).not.toHaveProperty("text");
      sawQuoteRequest = true;

      return new Response(
        JSON.stringify({
          quote: {
            ok: true,
            quoteId: "00000000-0000-4000-8000-00000000q100",
            action: "trade",
            quoteFingerprint: "a".repeat(64),
            issuedAt: "2026-07-17T12:00:00.000Z",
            serverTime: "2026-07-17T12:00:00.000Z",
            expiresAt: "2026-07-17T12:01:00.000Z",
            dollarsIn: 20,
            dollarsOut: 19.9,
            feeUsd: 0.1,
            floorUsd: 19.701,
            sourceChain: "Base",
            destChain: "Arbitrum",
            toAsset: "eth",
            sizeUsd: 20,
            publicationIntent: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const server = createLiveServer({
      profile: testProfile(wallet),
      wallet,
      lease,
      apiBaseUrl: "http://conviction.test",
      fetchImpl,
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "live-quote-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const listed = await client.listTools();
    const quoteTool = listed.tools.find(
      (tool) => tool.name === "conviction_quote_trade",
    );
    expect(JSON.stringify(quoteTool?.inputSchema)).not.toMatch(
      /side|dollarsIn|token|contract|prompt|text/i,
    );

    const result = await client.callTool({
      name: "conviction_quote_trade",
      arguments: {
        toAsset: "eth",
        sizeUsd: 20,
        destChain: "Arbitrum",
      },
    });

    expect(sawQuoteRequest).toBe(true);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      quoteId: "00000000-0000-4000-8000-00000000q100",
      expiresAt: "2026-07-17T12:01:00.000Z",
      dollarsIn: 20,
      floorUsd: 19.701,
      destChain: "Arbitrum",
      quoteFingerprint: "a".repeat(64),
    });
  });

  it("surfaces gate_failed with report details from the backend", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "gate_failed",
            message: "Publication gate failed: No route through your Universal Account.",
            gateReport: [
              {
                id: "routability",
                name: "UA routability",
                passed: false,
                detail: "No route through your Universal Account",
              },
            ],
            preview: {
              dollarsIn: 20,
              dollarsOut: 19.9,
              feeUsd: 0.1,
              floorUsd: 19.701,
              sourceChain: "Base",
              destChain: "Arbitrum",
            },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );

    const server = createLiveServer({
      profile: testProfile(wallet),
      wallet,
      lease,
      apiBaseUrl: "http://conviction.test",
      fetchImpl,
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "live-quote-gate", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const result = await client.callTool({
      name: "conviction_quote_trade",
      arguments: {
        toAsset: "usdc",
        sizeUsd: 20,
        publicationIntent: true,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "gate_failed",
      gateReport: [
        expect.objectContaining({
          passed: false,
          detail: "No route through your Universal Account",
        }),
      ],
      preview: expect.objectContaining({ dollarsIn: 20 }),
    });
  });

  it("rejects missing size locally with a stable invalid_input error", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    let calledBackend = false;
    const server = createLiveServer({
      profile: testProfile(wallet),
      wallet,
      lease,
      apiBaseUrl: "http://conviction.test",
      fetchImpl: async () => {
        calledBackend = true;
        return new Response("{}", { status: 500 });
      },
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "live-quote-invalid", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    const result = await client.callTool({
      name: "conviction_quote_trade",
      arguments: { toAsset: "eth" },
    });

    expect(calledBackend).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "invalid_input",
    });
  });

  it("stops tool handling cleanly after lease loss", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const client = await connectLiveServer({
      wallet,
      lease,
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });

    lease.markLost("replaced");

    for (const name of [
      "conviction_account_status",
      "conviction_list_convictions",
      "conviction_get_conviction",
      "conviction_summarize_feed",
      "conviction_get_receipt",
    ] as const) {
      const result = await client.callTool({
        name,
        arguments:
          name === "conviction_get_conviction"
            ? { entryId: "x" }
            : name === "conviction_get_receipt"
              ? { receiptId: "x" }
              : {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        code: "lease_lost",
      });
    }
  });
});
