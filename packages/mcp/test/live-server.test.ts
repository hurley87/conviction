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
});
