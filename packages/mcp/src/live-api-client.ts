import {
  AGENT_SUMMARIZE_FEED_PATH,
  agentConvictionPath,
  agentConvictionsListPath,
  agentReceiptPath,
  type AccountStatusResult,
  type ConvictionGetResult,
  type ConvictionListResult,
  type FeedSummaryResult,
  type ReceiptGetResult,
} from "./agent-reads-contract.js";
import { ConvictionApiError, type ApiErrorBody } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import { signAgentRequest } from "./signed-request.js";

export type {
  AccountStatusResult as LiveAgentStatus,
  ConvictionGetResult,
  ConvictionListResult,
  FeedSummaryResult,
  ReceiptGetResult,
  CompactConviction,
  UniversalBalance,
  DepositAddresses,
} from "./agent-reads-contract.js";

export type LiveLease = {
  leaseId: string;
  agentId: string;
  expiresAt: string;
  acquiredAt: string;
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
}): Promise<AccountStatusResult> {
  const payload = await signedFetch<{ status: AccountStatusResult }>({
    ...options,
    method: "GET",
    path: "/api/agents/status",
  });
  return payload.status;
}

/** Record that a non-value-moving doctor/status check succeeded. */
export async function markSetupVerified(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<AccountStatusResult> {
  const payload = await signedFetch<{ status: AccountStatusResult }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/setup-verify",
    body: {},
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return payload.status;
}

export async function fetchConvictionsPage(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  cursor?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<ConvictionListResult> {
  return signedFetch<ConvictionListResult>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "GET",
    path: agentConvictionsListPath({
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
    }),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export async function fetchConviction(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  entryId: string;
  fetchImpl?: typeof fetch;
}): Promise<ConvictionGetResult> {
  return signedFetch<ConvictionGetResult>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "GET",
    path: agentConvictionPath(options.entryId),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export async function fetchFeedSummary(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<FeedSummaryResult> {
  return signedFetch<FeedSummaryResult>({
    ...options,
    method: "GET",
    path: AGENT_SUMMARIZE_FEED_PATH,
  });
}

export async function fetchReceipt(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  receiptId: string;
  fetchImpl?: typeof fetch;
}): Promise<ReceiptGetResult> {
  return signedFetch<ReceiptGetResult>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "GET",
    path: agentReceiptPath(options.receiptId),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
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
