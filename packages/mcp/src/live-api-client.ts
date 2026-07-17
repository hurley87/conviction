import { ConvictionApiError, type ApiErrorBody } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import { signAgentRequest } from "./signed-request.js";

export type LiveAgentStatus = {
  ok: true;
  mode: "live";
  agentId: string;
  handle: string;
  operatorHandle: string;
  address: string;
  depositAddress: string;
  status: string;
  publicStatus: string;
  actionPolicy: {
    trade: boolean;
    back: boolean;
    publish: boolean;
  };
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  remainingBudgetUsd: number;
  fundingReady: boolean;
  funded: boolean;
};

export type LiveLease = {
  leaseId: string;
  agentId: string;
  expiresAt: string;
};

export type LeaseConflictDetails = {
  activeLeaseId?: string;
  activeLeaseExpiresAt?: string;
  leaseAgeMs?: number;
};

async function signedFetch<T>(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  method: string;
  path: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const base = options.apiBaseUrl.replace(/\/$/, "");
  const rawBody =
    options.body === undefined ? "" : JSON.stringify(options.body);
  const signed = await signAgentRequest({
    wallet: options.wallet,
    method: options.method,
    path: options.path,
    body: rawBody,
  });

  const headers: Record<string, string> = {
    ...signed.headers,
  };
  if (rawBody) {
    headers["content-type"] = "application/json";
  }

  const response = await (options.fetchImpl ?? fetch)(`${base}${options.path}`, {
    method: options.method,
    headers,
    ...(rawBody ? { body: rawBody } : {}),
  });

  const payload = (await response.json().catch(() => ({}))) as T &
    ApiErrorBody &
    LeaseConflictDetails & {
      error?: LeaseConflictDetails & { code?: string; message?: string };
    };

  if (!response.ok) {
    const error = new ConvictionApiError(
      payload.error?.code ?? "unavailable",
      payload.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
    );
    Object.assign(error, {
      activeLeaseId: payload.error?.activeLeaseId,
      activeLeaseExpiresAt: payload.error?.activeLeaseExpiresAt,
      leaseAgeMs: payload.error?.leaseAgeMs,
    });
    throw error;
  }

  return payload;
}

export async function fetchAgentStatus(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<LiveAgentStatus> {
  const payload = await signedFetch<{ status: LiveAgentStatus }>({
    ...options,
    method: "GET",
    path: "/api/agents/status",
  });
  return payload.status;
}

export async function acquireAgentLease(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  replace?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<LiveLease> {
  const payload = await signedFetch<{ lease: LiveLease }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/lease",
    body: options.replace ? { replace: true } : {},
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return payload.lease;
}

export async function renewAgentLease(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  leaseId: string;
  fetchImpl?: typeof fetch;
}): Promise<LiveLease> {
  const payload = await signedFetch<{ lease: LiveLease }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/lease/renew",
    body: { leaseId: options.leaseId },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return payload.lease;
}

export async function releaseAgentLease(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  leaseId: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await signedFetch<{ ok: true }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "DELETE",
    path: "/api/agents/lease",
    body: { leaseId: options.leaseId },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
