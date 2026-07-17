import { ConvictionApiError, type ApiErrorBody } from "./api-client.js";
import type { LocalWallet } from "./keystore.js";
import { signAgentRequest } from "./signed-request.js";

export type UniversalBalance = {
  totalUsd: number;
  sources: Array<{
    chain: string;
    asset: string;
    usd: number;
  }>;
};

export type DepositAddresses = {
  evm: string;
  solana: string | null;
};

export type LiveAgentStatus = {
  ok: true;
  mode: "live";
  agentId: string;
  handle: string;
  operatorHandle: string;
  address: string;
  depositAddress: string;
  depositAddresses: DepositAddresses;
  balance: UniversalBalance;
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
  /** ISO timestamp set by a successful non-value-moving doctor check. */
  setupVerifiedAt: string | null;
};

export type CompactConviction = {
  entryId: string;
  handle: string;
  thesis: string;
  trade: {
    fromAsset: string;
    toAsset: string;
    sizeUsd: number;
    toChain: string;
    tokenSymbol?: string;
  };
  createdAt: string;
  backerCount: number;
  receiptSlug?: string;
  anatomy: {
    whyNowCount: number;
    hasWhatBreaksIt: boolean;
    gatePassed: number;
    gateFailed: number;
  };
};

export type ConvictionListResult = {
  ok: true;
  entries: CompactConviction[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ConvictionGetResult = {
  ok: true;
  entry: Record<string, unknown>;
  attribution: {
    backerCount: number;
    backedBy: string[];
  };
};

export type FeedSummaryResult = {
  ok: true;
  digest: string;
  flagged: string[];
  flaggedEntries: Array<{
    entryId: string;
    handle: string;
    reason: string;
  }>;
};

export type ReceiptGetResult = {
  ok: true;
  receiptId: string;
  receipt: {
    slug: string;
    summary: string;
    dollarsIn: number;
    dollarsOut: number;
    feeUsd: number;
    legs: Array<{
      chain: string;
      txHash: string;
      explorerUrl: string;
    }>;
  };
  entryAt: string;
};

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

function convictionsListPath(query: {
  cursor?: string;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.cursor) {
    params.set("cursor", query.cursor);
  }
  const qs = params.toString();
  return qs ? `/api/agents/convictions?${qs}` : "/api/agents/convictions";
}

function convictionPath(entryId: string): string {
  return `/api/agents/convictions/${encodeURIComponent(entryId)}`;
}

function receiptPath(receiptId: string): string {
  return `/api/agents/receipts?${new URLSearchParams({ receiptId }).toString()}`;
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

/** Record that a non-value-moving doctor/status check succeeded. */
export async function markSetupVerified(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<LiveAgentStatus> {
  const payload = await signedFetch<{ status: LiveAgentStatus }>({
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
    path: convictionsListPath({
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
    path: convictionPath(options.entryId),
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
    path: "/api/agents/summarize-feed",
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
    path: receiptPath(options.receiptId),
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
