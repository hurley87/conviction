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

  it("delivers structured read-tool errors after tools/list enables output validation", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const readToolNames = [
      "conviction_account_status",
      "conviction_list_convictions",
      "conviction_get_conviction",
      "conviction_summarize_feed",
      "conviction_get_receipt",
    ] as const;

    const client = await connectLiveServer({
      wallet,
      lease,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;

        if (path.startsWith("/api/agents/convictions/")) {
          return new Response(
            JSON.stringify({
              error: { code: "not_found", message: "Conviction not found." },
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }

        if (path.startsWith("/api/agents/receipts")) {
          return new Response(
            JSON.stringify({
              error: { code: "not_found", message: "Receipt not found." },
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }

        if (path.startsWith("/api/agents/convictions")) {
          return new Response(
            JSON.stringify({
              error: {
                code: "invalid_request",
                message: "Invalid pagination cursor.",
              },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            error: { code: "unavailable", message: "Upstream timeout." },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      },
    });

    const listed = await client.listTools();
    for (const name of readToolNames) {
      const tool = listed.tools.find((entry) => entry.name === name);
      expect(tool?.outputSchema).toMatchObject({
        type: "object",
        oneOf: expect.any(Array),
      });
    }

    const missingConviction = await client.callTool({
      name: "conviction_get_conviction",
      arguments: { entryId: "missing" },
    });
    expect(missingConviction.isError).toBe(true);
    expect(missingConviction.structuredContent).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Conviction not found.",
    });

    const missingReceipt = await client.callTool({
      name: "conviction_get_receipt",
      arguments: { receiptId: "missing" },
    });
    expect(missingReceipt.isError).toBe(true);
    expect(missingReceipt.structuredContent).toMatchObject({
      ok: false,
      code: "not_found",
      message: "Receipt not found.",
    });

    const badCursor = await client.callTool({
      name: "conviction_list_convictions",
      arguments: { cursor: "not-a-cursor" },
    });
    expect(badCursor.isError).toBe(true);
    expect(badCursor.structuredContent).toMatchObject({
      ok: false,
      code: "invalid_request",
      message: "Invalid pagination cursor.",
    });

    const unavailable = await client.callTool({
      name: "conviction_account_status",
      arguments: {},
    });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.structuredContent).toMatchObject({
      ok: false,
      code: "unavailable",
      message: "Upstream timeout.",
    });

    lease.markLost("replaced");
    for (const name of readToolNames) {
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

  it("keeps happy-path output validation strict after tools/list", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const client = await connectLiveServer({
      wallet,
      lease,
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: sampleStatus(wallet.address) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    await client.listTools();
    const result = await client.callTool({
      name: "conviction_account_status",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      mode: "live",
      handle: "signal-scout",
      remainingBudgetUsd: 90,
    });
  });
});
