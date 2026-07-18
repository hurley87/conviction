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
import {
  ConvictionApiError,
  type ApiErrorBody,
  type ConvictionApiErrorDetails,
} from "./api-client.js";
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

export type LifecycleMutationResult = {
  agent: {
    agentId: string;
    handle: string;
    status: string;
    publicStatus: string;
    actionPolicy: { trade: boolean; back: boolean; publish: boolean };
    maxTradeUsd: number;
    spendBudgetUsd: number;
    lifetimeSpendUsd: number;
  };
  releasedPermitCount: number;
  privatePausedReason: string | null;
};

/** Operator CLI pause — not an MCP tool. */
export async function disableAgentLifecycle(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<LifecycleMutationResult> {
  return signedFetch<LifecycleMutationResult>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/lifecycle/disable",
    body: {},
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

/** Operator CLI re-enable — not an MCP tool. */
export async function enableAgentLifecycle(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  fetchImpl?: typeof fetch;
}): Promise<LifecycleMutationResult> {
  return signedFetch<LifecycleMutationResult>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/lifecycle/enable",
    body: {},
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
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

export type LiveExecutionPermit = {
  ok: true;
  permitId: string;
  quoteId: string;
  quoteFingerprint: string;
  dollarsIn: number;
  floorUsd: number;
  expiresAt: string;
  intent: Record<string, unknown>;
  sizeUsd: number;
  agreedQuote: {
    dollarsIn: number;
    dollarsOut: number;
    feeUsd: number;
    floorUsd: number;
    sourceChain: string;
    destChain: string;
    toAsset: string;
    receivedSymbol?: string;
    transactionId: string;
    rawTransaction: unknown;
  };
  rawTransaction: unknown;
  transactionId: string;
  idempotencyKey: string;
};

export type LiveExecuteSuccess = {
  ok: true;
  receiptId: string;
  quoteId: string;
  quoteFingerprint: string;
  transactionId: string;
  summary: string;
  receipt: {
    slug: string;
    summary: string;
    dollarsIn: number;
    dollarsOut: number;
    feeUsd: number;
    legs: Array<{ chain: string; txHash: string; explorerUrl: string }>;
  };
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  idempotencyKey: string;
  action?: "trade" | "back";
  entryId?: string;
  backRecordId?: string;
  reconciliationState?: "complete" | "pending_sync" | "needs_attention";
  authorship?: {
    agentId: string;
    authorKind: "agent";
    handle: string;
    operatorHandle: string;
  };
  code?: "executed_pending_sync";
};

export type LiveExecuteError = {
  ok: false;
  code: string;
  message: string;
  action?: "trade" | "back";
  quoteId?: string;
  fields?: Array<{ field: string; code: string; message: string }>;
};

export type LiveExecuteResult = LiveExecuteSuccess | LiveExecuteError;

/**
 * Exchange quote identity for a single-use execution permit (ADR 0020).
 * May return a prior durable execute result when the idempotency key completed.
 */
export async function requestExecutionPermit(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  quoteId: string;
  idempotencyKey: string;
  leaseId: string;
  /** When set, only this quote action may receive a permit. */
  expectedAction?: "trade" | "back";
  fetchImpl?: typeof fetch;
}): Promise<LiveExecutionPermit | LiveExecuteResult> {
  const payload = await signedFetch<{
    permit?: LiveExecutionPermit;
    result?: LiveExecuteResult;
    error?: LiveExecuteError;
  }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/execute/permit",
    body: {
      quoteId: options.quoteId,
      idempotencyKey: options.idempotencyKey,
      leaseId: options.leaseId,
      ...(options.expectedAction
        ? { expectedAction: options.expectedAction }
        : {}),
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (payload.permit) return payload.permit;
  if (payload.result) return payload.result;
  if (payload.error) return payload.error;
  throw new ConvictionApiError(
    "unavailable",
    "Execution permit response was empty.",
    503,
  );
}

/** Submit locally signed Particle payloads under an issued permit. */
export async function submitSignedExecution(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  permitId: string;
  idempotencyKey: string;
  leaseId: string;
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
  fetchImpl?: typeof fetch;
}): Promise<LiveExecuteResult> {
  const payload = await signedFetch<{
    result?: LiveExecuteResult;
    error?: LiveExecuteError;
  }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/execute/submit",
    body: {
      permitId: options.permitId,
      idempotencyKey: options.idempotencyKey,
      leaseId: options.leaseId,
      rootHashSignature: options.rootHashSignature,
      ...(options.authorizations
        ? { authorizations: options.authorizations }
        : {}),
    },
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (payload.result) return payload.result;
  if (payload.error) return payload.error;
  throw new ConvictionApiError(
    "unavailable",
    "Signed execution response was empty.",
    503,
  );
}

export type LivePublishRequest = {
  receiptId: string;
  thesis: string;
  whyNow: string;
  whatBreaksIt: string;
  leaseId: string;
};

export type LivePublishSuccess = {
  ok: true;
  entryId: string;
  receiptId: string;
  entry: ConvictionGetResult["entry"];
};

export type LivePublishError = {
  ok: false;
  code: string;
  message: string;
  action?: "publish";
  receiptId?: string;
  fields?: Array<{ field: string; code: string; message: string }>;
  gateReport?: QuoteApiErrorDetails["gateReport"];
};

export type LivePublishResult = LivePublishSuccess | LivePublishError;

/** Publish a conviction from a successful unique owned trade receipt. */
export async function publishConviction(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  input: LivePublishRequest;
  fetchImpl?: typeof fetch;
}): Promise<LivePublishResult> {
  const payload = await signedFetch<{
    result?: LivePublishSuccess;
    error?: LivePublishError;
  }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/publish",
    body: options.input,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (payload.result) return payload.result;
  if (payload.error) return payload.error;
  throw new ConvictionApiError(
    "unavailable",
    "Publish response was empty.",
    503,
  );
}

export type StructuredBackQuoteRequest = {
  entryId: string;
  dollarsIn?: number;
  fraction?: number;
  /** Extra keys are forwarded so the backend can reject forbidden overrides. */
  [key: string]: unknown;
};

export type LiveBackQuote = {
  ok: true;
  quoteId: string;
  action: "back";
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
  entryId: string;
  targetFingerprint: string;
};

/** Request a short-lived back quote derived from a canonical conviction. */
export async function requestBackQuote(options: {
  apiBaseUrl: string;
  wallet: LocalWallet;
  input: StructuredBackQuoteRequest;
  fetchImpl?: typeof fetch;
}): Promise<LiveBackQuote> {
  const payload = await signedFetch<{ quote: LiveBackQuote }>({
    apiBaseUrl: options.apiBaseUrl,
    wallet: options.wallet,
    method: "POST",
    path: "/api/agents/quote/back",
    body: options.input,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return payload.quote;
}
