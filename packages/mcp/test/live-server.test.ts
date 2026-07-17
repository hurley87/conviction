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

describe("createLiveServer", () => {
  it("exposes the complete canonical v1 tool contract", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const server = createLiveServer({
      profile: testProfile(wallet),
      wallet,
      lease,
      apiBaseUrl: "http://conviction.test",
      fetchImpl: async () => new Response("{}", { status: 500 }),
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

      return new Response(
        JSON.stringify({
          status: {
            ok: true,
            mode: "live",
            agentId: "00000000-0000-4000-8000-000000000111",
            handle: "signal-scout",
            operatorHandle: "operator",
            address: wallet.address,
            depositAddress: wallet.address,
            status: "active",
            publicStatus: "active",
            actionPolicy: { trade: true, back: true, publish: false },
            maxTradeUsd: 25,
            spendBudgetUsd: 100,
            lifetimeSpendUsd: 10,
            remainingBudgetUsd: 90,
            fundingReady: true,
            setupVerifiedAt: null,
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
    const client = new Client({ name: "live-status-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

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
      actionPolicy: { trade: true, back: true, publish: false },
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /privateKey|mnemonic|keystore/i,
    );
  });

  it("stops tool handling cleanly after lease loss", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const server = createLiveServer({
      profile: testProfile(wallet),
      wallet,
      lease,
      apiBaseUrl: "http://conviction.test",
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "live-lease-lost", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });

    lease.markLost("replaced");

    const result = await client.callTool({
      name: "conviction_account_status",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "lease_lost",
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
            intentFingerprint: "a".repeat(64),
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
            eligibleForExecution: true,
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
      intentFingerprint: "a".repeat(64),
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
});
