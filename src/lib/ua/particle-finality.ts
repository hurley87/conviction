import type {
  ExecutionLegKind,
  ExecutionLegStatus,
  ExecutionOutcome,
} from "@/lib/agent-execution-finality";
import { chainName, explorerUrl } from "@/lib/verbs/chains";

/**
 * Particle SDK 2.0.3 exposes getTransaction() as Promise<any>. Keep the
 * provider response unknown at this boundary and narrow every field before it
 * can influence durable execution state.
 */
export type ParticleTransactionStatusAccount = {
  getTransaction(transactionId: string): Promise<unknown>;
};

export type ParticleTransactionLeg = {
  legId: string;
  kind: ExecutionLegKind;
  chainId: number;
  chainName: string;
  required: boolean;
  status: ExecutionLegStatus;
  providerStatus: string | null;
  confirmedHash: string | null;
  explorerUrl: string | null;
  error: string | null;
  raw: unknown;
};

export type ParticleTransactionStatusRead = {
  transactionId: string;
  providerStatus: string | null;
  outcome: ExecutionOutcome;
  legs: ParticleTransactionLeg[];
  /** True only when another read-only status lookup is the safe next action. */
  retrySafe: boolean;
  error: string | null;
  /** Lossless provider response for durable evidence and future re-normalization. */
  raw: unknown;
};

const TRANSACTION_STATUS_NAMES: Record<number, string> = {
  0: "INITIALIZING",
  1: "DEPOSIT_LOCAL",
  2: "DEPOSIT_PENDING",
  3: "WAIT_TO_REFUND",
  4: "EXECUTION_LOCAL",
  5: "EXECUTION_PENDING",
  6: "EXECUTION_FAILED",
  7: "FINISHED",
  8: "REFUND_LOCAL",
  9: "REFUND_PENDING",
  10: "REFUND_FAILED",
  11: "REFUND_FINISHED",
  12: "PENNY_LOCAL",
  13: "PENNY_PENDING",
  14: "PENNY_FAILED",
};

const SUBMITTED_STATUSES = new Set([
  "INITIALIZING",
  "DEPOSIT_LOCAL",
  "EXECUTION_LOCAL",
  "REFUND_LOCAL",
  "PENNY_LOCAL",
]);
const PENDING_STATUSES = new Set([
  "DEPOSIT_PENDING",
  "WAIT_TO_REFUND",
  "EXECUTION_PENDING",
  "REFUND_PENDING",
  "PENNY_PENDING",
]);
const FAILURE_STATUSES = new Set([
  "EXECUTION_FAILED",
  "REFUND_FAILED",
  "REFUND_FINISHED",
  "PENNY_FAILED",
]);

type RecordLike = Record<string, unknown>;

type OperationArray = {
  field: string;
  kind: ExecutionLegKind;
  required: boolean;
};

const OPERATION_ARRAYS: OperationArray[] = [
  { field: "depositUserOperations", kind: "source", required: true },
  { field: "settlementUserOperations", kind: "bridge", required: true },
  { field: "lendingUserOperations", kind: "destination", required: true },
  { field: "refundUserOperations", kind: "transfer", required: false },
  { field: "pennyUserOperations", kind: "unknown", required: false },
];

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function providerStatus(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return TRANSACTION_STATUS_NAMES[value] ?? `UNKNOWN_${value}`;
  }
  if (typeof value === "string" && value.trim()) {
    return normalizeLabel(value);
  }
  return null;
}

function legProviderStatus(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return ({
      0: "LOCAL",
      1: "PENDING",
      2: "FAILED",
      3: "COMPLETED",
    } as Record<number, string>)[value] ?? `UNKNOWN_${value}`;
  }
  if (typeof value === "string" && value.trim()) {
    return normalizeLabel(value);
  }
  return null;
}

function normalizeLegStatus(status: string | null): ExecutionLegStatus {
  if (status === "COMPLETED" || status === "FINISHED" || status === "SUCCESS") {
    return "finalized";
  }
  if (status === "FAILED" || status === "FAILURE" || status === "REVERTED") {
    return "failed";
  }
  if (status === "LOCAL" || status === "SUBMITTED" || status === "INITIALIZING") {
    return "submitted";
  }
  if (status === "PENDING" || status === "PROCESSING") return "pending";
  return "needs_attention";
}

function operationError(operation: RecordLike): string | null {
  return (
    nonEmptyString(operation.error) ??
    nonEmptyString(operation.errorMessage) ??
    nonEmptyString(operation.reason) ??
    nonEmptyString(operation.message)
  );
}

function confirmedExplorerUrl(chainId: number, hash: string): string | null {
  return chainName(chainId) === `Chain ${chainId}`
    ? null
    : explorerUrl(chainId, hash);
}

function readActivity(raw: unknown): RecordLike | null {
  if (!isRecord(raw)) return null;
  if (raw.status !== undefined) return raw;
  return isRecord(raw.data) ? raw.data : raw;
}

function normalizeLegs(activity: RecordLike): {
  legs: ParticleTransactionLeg[];
  malformed: boolean;
} {
  const legs: ParticleTransactionLeg[] = [];
  let malformed = false;
  for (const source of OPERATION_ARRAYS) {
    const operations = activity[source.field];
    if (operations !== undefined && !Array.isArray(operations)) {
      malformed = true;
      continue;
    }
    if (!Array.isArray(operations)) continue;
    operations.forEach((rawOperation, index) => {
      if (!isRecord(rawOperation)) {
        malformed = true;
        return;
      }
      const chainId = rawOperation.chainId;
      if (
        typeof chainId !== "number" ||
        !Number.isInteger(chainId) ||
        chainId <= 0
      ) {
        malformed = true;
        return;
      }
      const normalizedProviderStatus = legProviderStatus(rawOperation.status);
      const status = normalizeLegStatus(normalizedProviderStatus);
      // userOpHash is submission intent. Only Particle's confirmed operation
      // txHash may become durable receipt evidence, and only on success.
      const confirmedHash =
        status === "finalized" ? nonEmptyString(rawOperation.txHash) : null;
      legs.push({
        legId: `${source.kind}:${chainId}:${index}`,
        kind: source.kind,
        chainId,
        chainName: chainName(chainId),
        required: source.required,
        status:
          status === "finalized" && confirmedHash === null
            ? "needs_attention"
            : status,
        providerStatus: normalizedProviderStatus,
        confirmedHash,
        explorerUrl: confirmedHash
          ? confirmedExplorerUrl(chainId, confirmedHash)
          : null,
        error: operationError(rawOperation),
        raw: rawOperation,
      });
    });
  }
  return { legs, malformed };
}

function failureOutcome(legs: ParticleTransactionLeg[]): ExecutionOutcome {
  const required = legs.filter((leg) => leg.required);
  return required.some((leg) => leg.status === "finalized")
    ? "partial"
    : "failed";
}

function attention(
  transactionId: string,
  raw: unknown,
  status: string | null,
  legs: ParticleTransactionLeg[],
  error: string,
): ParticleTransactionStatusRead {
  return {
    transactionId,
    providerStatus: status,
    outcome: "needs_attention",
    legs,
    retrySafe: false,
    error,
    raw,
  };
}

/** Pure, fail-closed mapping from Particle's untyped provider payload. */
export function normalizeParticleTransactionStatus(
  transactionId: string,
  raw: unknown,
): ParticleTransactionStatusRead {
  const activity = readActivity(raw);
  if (!activity) {
    return {
      transactionId,
      providerStatus: null,
      outcome: "pending",
      legs: [],
      retrySafe: true,
      error: "Particle returned a malformed transaction-status payload.",
      raw,
    };
  }

  const status = providerStatus(activity.status);
  const { legs, malformed: malformedLegs } = normalizeLegs(activity);
  const returnedTransactionId = nonEmptyString(activity.transactionId);
  if (returnedTransactionId && returnedTransactionId !== transactionId) {
    return attention(
      transactionId,
      raw,
      status,
      [],
      `Particle returned transaction ${returnedTransactionId} for ${transactionId}.`,
    );
  }

  if (status === null) {
    return {
      transactionId,
      providerStatus: null,
      outcome: "pending",
      legs,
      retrySafe: true,
      error: "Particle has not returned a transaction status yet.",
      raw,
    };
  }

  if (status === "FINISHED") {
    const required = legs.filter((leg) => leg.required);
    if (
      malformedLegs ||
      required.length === 0 ||
      required.some((leg) => leg.status !== "finalized")
    ) {
      return attention(
        transactionId,
        raw,
        status,
        legs,
        "Particle reported FINISHED without confirmed provider results for every required leg.",
      );
    }
    return {
      transactionId,
      providerStatus: status,
      outcome: "finalized",
      legs,
      retrySafe: false,
      error: null,
      raw,
    };
  }

  if (FAILURE_STATUSES.has(status)) {
    if (malformedLegs) {
      return attention(
        transactionId,
        raw,
        status,
        legs,
        `Particle ${status} included malformed per-chain results.`,
      );
    }
    return {
      transactionId,
      providerStatus: status,
      outcome: failureOutcome(legs),
      legs,
      retrySafe: false,
      error: `Particle transaction ended with ${status}.`,
      raw,
    };
  }

  if (SUBMITTED_STATUSES.has(status) || PENDING_STATUSES.has(status)) {
    if (
      malformedLegs ||
      legs.some(
        (leg) =>
          leg.status === "failed" || leg.status === "needs_attention",
      )
    ) {
      return attention(
        transactionId,
        raw,
        status,
        legs,
        `Particle ${status} conflicts with a failed or unknown required leg.`,
      );
    }
    return {
      transactionId,
      providerStatus: status,
      outcome: SUBMITTED_STATUSES.has(status) ? "submitted" : "pending",
      legs,
      retrySafe: true,
      error: null,
      raw,
    };
  }

  return attention(
    transactionId,
    raw,
    status,
    legs,
    `Particle returned unsupported transaction status ${status}.`,
  );
}

/** Typed read seam around the SDK's Promise<any> getTransaction contract. */
export async function readParticleTransactionStatus(
  account: ParticleTransactionStatusAccount,
  transactionId: string,
): Promise<ParticleTransactionStatusRead> {
  return normalizeParticleTransactionStatus(
    transactionId,
    await account.getTransaction(transactionId),
  );
}
