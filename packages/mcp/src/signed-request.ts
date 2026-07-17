import { createHash, randomBytes } from "node:crypto";

import { getAddress } from "ethers";

import type { LocalWallet } from "./keystore.js";

export const AGENT_REQUEST_PROOF_PREFIX = "Conviction MCP request";

/** SHA-256 hex digest of the exact request body bytes. */
export function hashRequestBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function buildAgentRequestMessage(input: {
  method: string;
  path: string;
  bodyHash: string;
  timestampMs: string;
  nonce: string;
  agentAddress: string;
}): string {
  return [
    AGENT_REQUEST_PROOF_PREFIX,
    "v1",
    `method:${input.method.toUpperCase()}`,
    `path:${input.path}`,
    `body:${input.bodyHash}`,
    `timestamp:${input.timestampMs}`,
    `nonce:${input.nonce}`,
    `agent:${getAddress(input.agentAddress)}`,
  ].join("\n");
}

export type SignedRequestHeaders = {
  "x-conviction-agent": string;
  "x-conviction-timestamp": string;
  "x-conviction-nonce": string;
  "x-conviction-signature": string;
};

export async function signAgentRequest(options: {
  wallet: LocalWallet;
  method: string;
  path: string;
  body?: string;
  nowMs?: number;
  nonce?: string;
}): Promise<{
  headers: SignedRequestHeaders;
  body: string;
  message: string;
}> {
  const body = options.body ?? "";
  const timestampMs = String(options.nowMs ?? Date.now());
  const nonce = options.nonce ?? randomBytes(16).toString("hex");
  const agentAddress = getAddress(options.wallet.address);
  const message = buildAgentRequestMessage({
    method: options.method,
    path: options.path,
    bodyHash: hashRequestBody(body),
    timestampMs,
    nonce,
    agentAddress,
  });
  const signature = await options.wallet.signMessage(message);
  return {
    headers: {
      "x-conviction-agent": agentAddress,
      "x-conviction-timestamp": timestampMs,
      "x-conviction-nonce": nonce,
      "x-conviction-signature": signature,
    },
    body,
    message,
  };
}
