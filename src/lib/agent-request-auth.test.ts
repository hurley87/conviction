import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import {
  createPendingAgent,
  MemoryAgentProvisioningStore,
  redeemPendingAgent,
  buildProvisioningProofMessage,
  hashProvisioningCode,
} from "@/lib/agent-provisioning";
import {
  AGENT_REQUEST_MAX_SKEW_MS,
  MemoryAgentNonceStore,
  buildAgentRequestMessage,
  hashRequestBody,
  verifyAgentRequest,
} from "@/lib/agent-request-auth";

const OWNER = { userId: "did:privy:owner-auth", operatorHandle: "operator" };
const FIXED_NOW = new Date("2026-07-17T12:00:00.000Z");

async function provisionedStore(wallet: Wallet) {
  const store = new MemoryAgentProvisioningStore();
  const created = await createPendingAgent(
    store,
    OWNER,
    {
      handle: "auth-scout",
      returnAddress: "0x0000000000000000000000000000000000000001",
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      actionPolicy: { trade: true, back: true, publish: true },
    },
    {
      now: () => FIXED_NOW,
      randomId: (() => {
        const ids = [
          "00000000-0000-4000-8000-0000000000a1",
          "00000000-0000-4000-8000-0000000000a2",
        ];
        return () => ids.shift()!;
      })(),
      randomCode: () => "auth-provisioning-code",
      apiBaseUrl: "https://app.getconviction.com",
    },
  );

  const codeHash = hashProvisioningCode(created.handoff.code);
  const proofSignature = await wallet.signMessage(
    buildProvisioningProofMessage(codeHash, wallet.address),
  );
  await redeemPendingAgent(
    store,
    {
      code: created.handoff.code,
      signerAddress: wallet.address,
      proofSignature,
    },
    { now: () => FIXED_NOW },
  );
  return store;
}

async function signedRequest(options: {
  wallet: Wallet;
  method: string;
  path: string;
  body?: string;
  timestampMs?: number;
  nonce?: string;
}) {
  const body = options.body ?? "";
  const timestampMs = String(options.timestampMs ?? FIXED_NOW.getTime());
  const nonce = options.nonce ?? "aabbccddeeff00112233445566778899";
  const message = buildAgentRequestMessage({
    method: options.method,
    path: options.path,
    bodyHash: hashRequestBody(body),
    timestampMs,
    nonce,
    agentAddress: options.wallet.address,
  });
  const signature = await options.wallet.signMessage(message);
  return new Request(`https://conviction.test${options.path}`, {
    method: options.method,
    headers: {
      "x-conviction-agent": options.wallet.address,
      "x-conviction-timestamp": timestampMs,
      "x-conviction-nonce": nonce,
      "x-conviction-signature": signature,
    },
    ...(body ? { body } : {}),
  });
}

describe("verifyAgentRequest", () => {
  it("accepts a valid signed request and resolves the bound agent", async () => {
    const wallet = Wallet.createRandom();
    const store = await provisionedStore(wallet);
    const nonceStore = new MemoryAgentNonceStore();
    const request = await signedRequest({
      wallet,
      method: "GET",
      path: "/api/agents/status",
    });

    const verified = await verifyAgentRequest({
      request,
      rawBody: "",
      path: "/api/agents/status",
      store,
      nonceStore,
      now: () => FIXED_NOW,
    });

    expect(verified.agent.handle).toBe("auth-scout");
    expect(verified.agentAddress).toBe(wallet.address);
  });

  it("rejects a replayed nonce", async () => {
    const wallet = Wallet.createRandom();
    const store = await provisionedStore(wallet);
    const nonceStore = new MemoryAgentNonceStore();
    const request = await signedRequest({
      wallet,
      method: "GET",
      path: "/api/agents/status",
      nonce: "0123456789abcdef0123456789abcdef",
    });

    await verifyAgentRequest({
      request,
      rawBody: "",
      path: "/api/agents/status",
      store,
      nonceStore,
      now: () => FIXED_NOW,
    });

    await expect(
      verifyAgentRequest({
        request,
        rawBody: "",
        path: "/api/agents/status",
        store,
        nonceStore,
        now: () => FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "replay_rejected" });
  });

  it("rejects timestamps outside the skew window", async () => {
    const wallet = Wallet.createRandom();
    const store = await provisionedStore(wallet);
    const nonceStore = new MemoryAgentNonceStore();
    const request = await signedRequest({
      wallet,
      method: "GET",
      path: "/api/agents/status",
      timestampMs: FIXED_NOW.getTime() - AGENT_REQUEST_MAX_SKEW_MS - 1,
    });

    await expect(
      verifyAgentRequest({
        request,
        rawBody: "",
        path: "/api/agents/status",
        store,
        nonceStore,
        now: () => FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "timestamp_skew" });
  });

  it("rejects a signature from the wrong wallet", async () => {
    const wallet = Wallet.createRandom();
    const other = Wallet.createRandom();
    const store = await provisionedStore(wallet);
    const nonceStore = new MemoryAgentNonceStore();
    // Spoof the agent header to the bound address while signing with another key.
    const body = "";
    const timestampMs = String(FIXED_NOW.getTime());
    const nonce = "fedcba9876543210fedcba9876543210";
    const message = buildAgentRequestMessage({
      method: "GET",
      path: "/api/agents/status",
      bodyHash: hashRequestBody(body),
      timestampMs,
      nonce,
      agentAddress: wallet.address,
    });
    const signature = await other.signMessage(message);
    const spoofed = new Request("https://conviction.test/api/agents/status", {
      method: "GET",
      headers: {
        "x-conviction-agent": wallet.address,
        "x-conviction-timestamp": timestampMs,
        "x-conviction-nonce": nonce,
        "x-conviction-signature": signature,
      },
    });

    await expect(
      verifyAgentRequest({
        request: spoofed,
        rawBody: "",
        path: "/api/agents/status",
        store,
        nonceStore,
        now: () => FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "invalid_auth" });
  });
});
