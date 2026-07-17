import {
  ConvictionApiError,
  type ApiErrorBody,
  type ConvictionApiErrorDetails,
} from "./api-client.js";
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
  /** ISO timestamp set by a successful non-value-moving doctor check. */
  setupVerifiedAt: string | null;
};

export type LiveLease = {
  leaseId: string;
  agentId: string;
  expiresAt: string;
  acquiredAt: string;
};

export type QuoteApiErrorDetails = Pick<
  ConvictionApiErrorDetails,
  "fields" | "gateReport" | "preview"
>;

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
    ApiErrorBody & {
      error?: ConvictionApiErrorDetails & { code?: string; message?: string };
    };

  if (!response.ok) {
    throw new ConvictionApiError(
      payload.error?.code ?? "unavailable",
      payload.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      {
        ...(payload.error?.activeLeaseId
          ? { activeLeaseId: payload.error.activeLeaseId }
          : {}),
        ...(payload.error?.activeLeaseExpiresAt
          ? { activeLeaseExpiresAt: payload.error.activeLeaseExpiresAt }
          : {}),
        ...(payload.error?.leaseAgeMs !== undefined
          ? { leaseAgeMs: payload.error.leaseAgeMs }
          : {}),
        ...(payload.error?.fields ? { fields: payload.error.fields } : {}),
        ...(payload.error?.gateReport
          ? { gateReport: payload.error.gateReport }
          : {}),
        ...(payload.error?.preview ? { preview: payload.error.preview } : {}),
      },
    );
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

export type StructuredTradeQuoteRequest = {
  toAsset: string;
  fromAsset?: string;
  sizeUsd?: number;
  fraction?: number;
  destChain?: "Arbitrum" | "Base";
  publicationIntent?: boolean;
};

export type LiveTradeQuote = {
  ok: true;
  quoteId: string;
  action: "trade";
  quoteFingerprint: string;
  issuedAt: string;
  serverTime: string;
  expiresAt: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  floorUsd: number;
  sourceChain: string;
  destChain: string;
  toAsset: string;
  receivedSymbol?: string;
  sizeUsd: number;
  publicationIntent: boolean;
  gateReport?: QuoteApiErrorDetails["gateReport"];
  gateVersion?: string;
  targetFingerprint?: string;
};

/** Request a short-lived structured trade quote (research-only; no funds moved). */
export async function requestTradeQuote(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  input: StructuredTradeQuoteRequest;
  fetchImpl?: typeof fetch;
}): Promise<LiveTradeQuote> {
  const payload = await signedFetch<{ quote: LiveTradeQuote }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/quote/trade",
    body: options.input,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return payload.quote;
}
