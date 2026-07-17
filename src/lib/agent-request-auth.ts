import { createHash } from "node:crypto";
import { getAddress, isAddress } from "ethers";
import { getSql } from "@/lib/db";
import {
  type AgentProvisioningStore,
  type OwnedAgent,
  verifyEoaSignature,
} from "@/lib/agent-provisioning";

export const AGENT_REQUEST_PROOF_PREFIX = "Conviction MCP request";
export const AGENT_REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;
export const AGENT_NONCE_TTL_MS = 10 * 60 * 1000;

export type AgentRequestAuthErrorCode =
  | "missing_auth"
  | "invalid_auth"
  | "timestamp_skew"
  | "replay_rejected"
  | "signer_mismatch"
  | "agent_not_found";

export class AgentRequestAuthError extends Error {
  constructor(
    public readonly code: AgentRequestAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRequestAuthError";
  }
}

export type AgentNonceStore = {
  consume(input: {
    nonce: string;
    agentId: string;
    now: Date;
  }): Promise<void>;
};

export class MemoryAgentNonceStore implements AgentNonceStore {
  private readonly used = new Map<string, { agentId: string; usedAt: number }>();

  async consume(input: {
    nonce: string;
    agentId: string;
    now: Date;
  }): Promise<void> {
    this.prune(input.now.getTime());
    if (this.used.has(input.nonce)) {
      throw new AgentRequestAuthError(
        "replay_rejected",
        "That request nonce was already used. Retry with a fresh nonce.",
      );
    }
    this.used.set(input.nonce, {
      agentId: input.agentId,
      usedAt: input.now.getTime(),
    });
  }

  private prune(nowMs: number): void {
    for (const [nonce, entry] of this.used) {
      if (nowMs - entry.usedAt > AGENT_NONCE_TTL_MS) {
        this.used.delete(nonce);
      }
    }
  }
}

let neonNonceSchemaReady = false;
const memoryNonceStore = new MemoryAgentNonceStore();

class NeonAgentNonceStore implements AgentNonceStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  private async ensureSchema(): Promise<void> {
    if (neonNonceSchemaReady) return;
    await this.sql`
      CREATE TABLE IF NOT EXISTS agent_request_nonces (
        nonce text PRIMARY KEY,
        agent_id uuid NOT NULL,
        used_at timestamptz NOT NULL
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS agent_request_nonces_used_at
        ON agent_request_nonces (used_at)
    `;
    neonNonceSchemaReady = true;
  }

  async consume(input: {
    nonce: string;
    agentId: string;
    now: Date;
  }): Promise<void> {
    await this.ensureSchema();
    const cutoff = new Date(input.now.getTime() - AGENT_NONCE_TTL_MS).toISOString();
    await this.sql`
      DELETE FROM agent_request_nonces WHERE used_at < ${cutoff}::timestamptz
    `;
    try {
      await this.sql`
        INSERT INTO agent_request_nonces (nonce, agent_id, used_at)
        VALUES (
          ${input.nonce},
          ${input.agentId}::uuid,
          ${input.now.toISOString()}::timestamptz
        )
      `;
    } catch (error) {
      const constraint = (error as { constraint?: string }).constraint;
      if (constraint === "agent_request_nonces_pkey") {
        throw new AgentRequestAuthError(
          "replay_rejected",
          "That request nonce was already used. Retry with a fresh nonce.",
        );
      }
      throw error;
    }
  }
}

export function getAgentNonceStore(): AgentNonceStore {
  const sql = getSql();
  if (sql) return new NeonAgentNonceStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent nonce storage is not configured.");
  }
  return memoryNonceStore;
}

/** SHA-256 hex digest of the exact request body bytes (empty string for no body). */
export function hashRequestBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** Canonical EIP-191 message for an authenticated agent API request. */
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

export type VerifiedAgentRequest = {
  agent: OwnedAgent;
  agentAddress: string;
  nonce: string;
  timestampMs: number;
};

function readHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
}

/**
 * Authenticate an agent API request via signed envelope headers.
 * Expects: x-conviction-agent, x-conviction-timestamp, x-conviction-nonce,
 * x-conviction-signature, and a matching body hash for the raw body text.
 */
export async function verifyAgentRequest(options: {
  request: Request;
  rawBody: string;
  path: string;
  store: AgentProvisioningStore;
  nonceStore: AgentNonceStore;
  now?: () => Date;
}): Promise<VerifiedAgentRequest> {
  const method = options.request.method.toUpperCase();
  const agentHeader = readHeader(options.request, "x-conviction-agent");
  const timestampHeader = readHeader(options.request, "x-conviction-timestamp");
  const nonce = readHeader(options.request, "x-conviction-nonce");
  const signature = readHeader(options.request, "x-conviction-signature");

  if (!agentHeader || !timestampHeader || !nonce || !signature) {
    throw new AgentRequestAuthError(
      "missing_auth",
      "Authenticated agent requests require agent, timestamp, nonce, and signature headers.",
    );
  }

  if (!isAddress(agentHeader)) {
    throw new AgentRequestAuthError(
      "invalid_auth",
      "x-conviction-agent must be a valid EVM address.",
    );
  }

  if (!/^\d+$/.test(timestampHeader)) {
    throw new AgentRequestAuthError(
      "invalid_auth",
      "x-conviction-timestamp must be a Unix millisecond timestamp.",
    );
  }

  if (!/^[a-f0-9]{32}$/i.test(nonce)) {
    throw new AgentRequestAuthError(
      "invalid_auth",
      "x-conviction-nonce must be a 16-byte hex string.",
    );
  }

  const timestampMs = Number(timestampHeader);
  const now = options.now?.() ?? new Date();
  if (Math.abs(now.getTime() - timestampMs) > AGENT_REQUEST_MAX_SKEW_MS) {
    throw new AgentRequestAuthError(
      "timestamp_skew",
      "The request timestamp is outside the allowed skew window.",
    );
  }

  const agentAddress = getAddress(agentHeader);
  const bodyHash = hashRequestBody(options.rawBody);
  const message = buildAgentRequestMessage({
    method,
    path: options.path,
    bodyHash,
    timestampMs: timestampHeader,
    nonce: nonce.toLowerCase(),
    agentAddress,
  });

  if (!verifyEoaSignature(message, signature, agentAddress)) {
    throw new AgentRequestAuthError(
      "invalid_auth",
      "The request signature does not match the agent address.",
    );
  }

  const agent = await options.store.findBySignerAddress(agentAddress);
  if (!agent) {
    throw new AgentRequestAuthError(
      "agent_not_found",
      "No agent is bound to that signer address.",
    );
  }

  if (!agent.address || getAddress(agent.address) !== agentAddress) {
    throw new AgentRequestAuthError(
      "signer_mismatch",
      "The authenticated signer does not match the bound agent address.",
    );
  }

  await options.nonceStore.consume({
    nonce: nonce.toLowerCase(),
    agentId: agent.agentId,
    now,
  });

  return {
    agent,
    agentAddress,
    nonce: nonce.toLowerCase(),
    timestampMs,
  };
}

export function agentAuthErrorStatus(code: AgentRequestAuthErrorCode): number {
  switch (code) {
    case "agent_not_found":
      return 404;
    case "replay_rejected":
    case "signer_mismatch":
      return 409;
    case "timestamp_skew":
    case "missing_auth":
    case "invalid_auth":
      return 401;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
