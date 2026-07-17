import { randomUUID } from "node:crypto";
import type { OwnedAgent } from "@/lib/agent-provisioning";

/** Default MCP lease lifetime before heartbeat renewal is required. */
export const MCP_LEASE_TTL_MS = 120_000;

export type AgentLease = {
  leaseId: string;
  agentId: string;
  expiresAt: string;
};

export type LeaseErrorCode =
  | "lease_conflict"
  | "lease_expired"
  | "lease_not_found"
  | "agent_not_found"
  | "invalid_request";

export class AgentLeaseError extends Error {
  constructor(
    public readonly code: LeaseErrorCode,
    message: string,
    public readonly details: {
      activeLeaseId?: string;
      activeLeaseExpiresAt?: string;
      leaseAgeMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "AgentLeaseError";
  }
}

export type LeaseStore = {
  findBySignerAddress(signerAddress: string): Promise<OwnedAgent | null>;
  getActiveLease(agentId: string, now: Date): Promise<AgentLease | null>;
  acquireLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
    replace?: boolean;
  }): Promise<AgentLease>;
  renewLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
  }): Promise<AgentLease>;
  releaseLease(input: { agentId: string; leaseId: string }): Promise<void>;
};

export function leaseErrorStatus(code: LeaseErrorCode): number {
  switch (code) {
    case "agent_not_found":
    case "lease_not_found":
      return 404;
    case "lease_conflict":
    case "lease_expired":
      return 409;
    case "invalid_request":
      return 422;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

/**
 * Acquire a renewable MCP lease for the authenticated agent.
 * A second concurrent process is rejected with actionable lease age details
 * unless `replace` is explicitly true.
 */
export async function acquireAgentLease(
  store: LeaseStore,
  agent: OwnedAgent,
  options: {
    replace?: boolean;
    now?: () => Date;
    randomId?: () => string;
    ttlMs?: number;
  } = {},
): Promise<AgentLease> {
  const now = options.now?.() ?? new Date();
  const ttlMs = options.ttlMs ?? MCP_LEASE_TTL_MS;
  const leaseId = options.randomId?.() ?? randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  try {
    return await store.acquireLease({
      agentId: agent.agentId,
      leaseId,
      expiresAt,
      now,
      ...(options.replace ? { replace: true } : {}),
    });
  } catch (error) {
    if (error instanceof AgentLeaseError) throw error;
    throw error;
  }
}

export async function renewAgentLease(
  store: LeaseStore,
  agent: OwnedAgent,
  leaseId: string,
  options: {
    now?: () => Date;
    ttlMs?: number;
  } = {},
): Promise<AgentLease> {
  if (!leaseId.trim()) {
    throw new AgentLeaseError(
      "invalid_request",
      "leaseId is required to renew an MCP lease.",
    );
  }

  const now = options.now?.() ?? new Date();
  const ttlMs = options.ttlMs ?? MCP_LEASE_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  return store.renewLease({
    agentId: agent.agentId,
    leaseId,
    expiresAt,
    now,
  });
}

export async function releaseAgentLease(
  store: LeaseStore,
  agent: OwnedAgent,
  leaseId: string,
): Promise<void> {
  if (!leaseId.trim()) {
    throw new AgentLeaseError(
      "invalid_request",
      "leaseId is required to release an MCP lease.",
    );
  }
  await store.releaseLease({ agentId: agent.agentId, leaseId });
}

/** Public account status shaped for conviction_account_status. */
export function buildAgentAccountStatus(agent: OwnedAgent): {
  ok: true;
  mode: "live";
  agentId: string;
  handle: string;
  operatorHandle: string;
  address: string;
  depositAddress: string;
  status: OwnedAgent["status"];
  publicStatus: OwnedAgent["publicStatus"];
  actionPolicy: OwnedAgent["actionPolicy"];
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  remainingBudgetUsd: number;
  fundingReady: boolean;
  funded: boolean;
} {
  const remainingBudgetUsd = Math.max(
    0,
    agent.spendBudgetUsd - agent.lifetimeSpendUsd,
  );
  const address = agent.address ?? "";
  return {
    ok: true,
    mode: "live",
    agentId: agent.agentId,
    handle: agent.handle,
    operatorHandle: agent.operatorHandle,
    address,
    depositAddress: address,
    status: agent.status,
    publicStatus: agent.publicStatus,
    actionPolicy: agent.actionPolicy,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    lifetimeSpendUsd: agent.lifetimeSpendUsd,
    remainingBudgetUsd,
    fundingReady: agent.fundingReady,
    // Unified balance is not wired in this slice; fundingReady + address are authoritative.
    funded: false,
  };
}

/** Helper used by Neon/memory stores when a conflicting lease is active. */
export function leaseConflictError(
  active: AgentLease,
  now: Date,
): AgentLeaseError {
  const leaseAgeMs = Math.max(
    0,
    now.getTime() - (new Date(active.expiresAt).getTime() - MCP_LEASE_TTL_MS),
  );
  return new AgentLeaseError(
    "lease_conflict",
    `Another MCP process already holds the lease for this agent (age ${Math.round(leaseAgeMs / 1000)}s, expires ${active.expiresAt}). Wait for expiry or explicitly replace the lease.`,
    {
      activeLeaseId: active.leaseId,
      activeLeaseExpiresAt: active.expiresAt,
      leaseAgeMs,
    },
  );
}
