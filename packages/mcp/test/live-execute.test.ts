import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Wallet, getBytes, verifyMessage } from "ethers";

import { LeaseHandle } from "../src/lease.js";
import { createLiveServer } from "../src/live-server.js";
import type { AgentProfile } from "../src/profile.js";

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

async function connectLive(options: {
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
  const client = new Client({ name: "live-execute-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

const ROOT_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("live conviction_execute_trade", () => {
  it("obtains a permit, signs locally, submits, and returns a durable receipt", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    const seen: string[] = [];
    let capturedRootSig: string | undefined;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      seen.push(`${init?.method ?? "GET"} ${url.pathname}`);
      const body = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.pathname === "/api/agents/execute/permit") {
        expect(body).toMatchObject({
          quoteId: "quote-1",
          idempotencyKey: "idem-live-1",
          leaseId: "lease-test-1",
        });
        return new Response(
          JSON.stringify({
            permit: {
              ok: true,
              permitId: "permit-1",
              quoteId: "quote-1",
              quoteFingerprint: "fp-1",
              dollarsIn: 20,
              floorUsd: 19.7,
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
              intent: { toAsset: "eth", destChain: "Arbitrum" },
              sizeUsd: 20,
              agreedQuote: {
                dollarsIn: 20,
                dollarsOut: 19.9,
                feeUsd: 0.1,
                floorUsd: 19.7,
                sourceChain: "Base",
                destChain: "Arbitrum",
                toAsset: "eth",
                transactionId: "tx-quote-1",
                rawTransaction: { rootHash: ROOT_HASH },
              },
              rawTransaction: {
                rootHash: ROOT_HASH,
                userOps: [
                  {
                    chainId: 42161,
                    userOpHash: "0xop1",
                    eip7702Auth: {
                      address: "0x1111111111111111111111111111111111111111",
                      chainId: 42161,
                      nonce: 0,
                    },
                    eip7702Delegated: false,
                  },
                ],
              },
              transactionId: "tx-quote-1",
              idempotencyKey: "idem-live-1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/agents/execute/submit") {
        capturedRootSig = body.rootHashSignature;
        expect(body.permitId).toBe("permit-1");
        expect(body.idempotencyKey).toBe("idem-live-1");
        expect(body.rootHashSignature).toMatch(/^0x/);
        expect(verifyMessage(getBytes(ROOT_HASH), body.rootHashSignature)).toBe(
          wallet.address,
        );
        expect(body.authorizations).toHaveLength(1);
        expect(body.authorizations[0].userOpHash).toBe("0xop1");
        expect(body.authorizations[0].signature).toMatch(/^0x/);

        return new Response(
          JSON.stringify({
            result: {
              ok: true,
              receiptId: "rcpt-live-1",
              quoteId: "quote-1",
              quoteFingerprint: "fp-1",
              transactionId: "tx-exec-1",
              summary: "Done — $20.00 moved.",
              receipt: {
                slug: "rcpt-live-1",
                summary: "Done — $20.00 moved.",
                dollarsIn: 20,
                dollarsOut: 19.9,
                feeUsd: 0.1,
                legs: [
                  {
                    chain: "Base",
                    txHash: "0xabc",
                    explorerUrl: "https://example.test/abc",
                  },
                  {
                    chain: "Arbitrum",
                    txHash: "0xdef",
                    explorerUrl: "https://example.test/def",
                  },
                ],
              },
              dollarsIn: 20,
              dollarsOut: 19.9,
              feeUsd: 0.1,
              idempotencyKey: "idem-live-1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ error: { code: "unavailable" } }), {
        status: 500,
      });
    };

    const client = await connectLive({ wallet, lease, fetchImpl });
    const result = await client.callTool({
      name: "conviction_execute_trade",
      arguments: {
        quoteId: "quote-1",
        idempotencyKey: "idem-live-1",
      },
    });

    expect(seen).toEqual([
      "POST /api/agents/execute/permit",
      "POST /api/agents/execute/submit",
    ]);
    expect(capturedRootSig).toBeTruthy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      mode: "live",
      receiptId: "rcpt-live-1",
      quoteId: "quote-1",
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /privateKey|mnemonic|keystore|signMessage/i,
    );
  });

  it("fails closed before signing when the permit backend is unavailable", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    let signed = false;

    const originalSignMessage = wallet.signMessage.bind(wallet);
    wallet.signMessage = async (message) => {
      // Agent API auth still signs request envelopes; only Particle rootHash
      // signing must not happen. Detect rootHash byte payloads by length.
      if (typeof message !== "string") {
        signed = true;
      }
      return originalSignMessage(message);
    };

    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agents/execute/permit") {
        return new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "backend down",
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 500 });
    };

    const client = await connectLive({ wallet, lease, fetchImpl });
    const result = await client.callTool({
      name: "conviction_execute_trade",
      arguments: {
        quoteId: "quote-1",
        idempotencyKey: "idem-down",
      },
    });

    expect(signed).toBe(false);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      code: "unavailable",
    });
  });

  it("returns a prior durable result without a second submit", async () => {
    const wallet = Wallet.createRandom();
    const lease = mockLease(wallet);
    let submits = 0;

    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/agents/execute/permit") {
        return new Response(
          JSON.stringify({
            result: {
              ok: true,
              receiptId: "rcpt-cached",
              quoteId: "quote-1",
              quoteFingerprint: "fp-1",
              transactionId: "tx-1",
              summary: "Done",
              receipt: {
                slug: "rcpt-cached",
                summary: "Done",
                dollarsIn: 20,
                dollarsOut: 19.9,
                feeUsd: 0.1,
                legs: [],
              },
              dollarsIn: 20,
              dollarsOut: 19.9,
              feeUsd: 0.1,
              idempotencyKey: "idem-cached",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/api/agents/execute/submit") {
        submits += 1;
      }
      return new Response("{}", { status: 500 });
    };

    const client = await connectLive({ wallet, lease, fetchImpl });
    const result = await client.callTool({
      name: "conviction_execute_trade",
      arguments: {
        quoteId: "quote-1",
        idempotencyKey: "idem-cached",
      },
    });

    expect(submits).toBe(0);
    expect(result.structuredContent).toMatchObject({
      ok: true,
      mode: "live",
      receiptId: "rcpt-cached",
    });
  });
});
