// Read-only retirement leg finality reconciliation (issue #60 / ADR 0035 /
// 0021). Extracted from agent-retirement to keep the retirement module focused
// on quoting, signing seams, and orchestration. This module never signs,
// requotes, or submits — it only interprets Particle's read-only status seam and
// updates durable leg finality.

import { randomUUID } from "node:crypto";

import type {
  ExecutionLeg,
  ExecutionOutcome,
  ExecutionProviderEvidence,
} from "@/lib/agent-execution-finality";
import {
  decideFinalityFromParticleRead,
  particleReadEvidence,
} from "@/lib/agent-particle-finality-policy";
import type {
  AgentRetirementRecord,
  AgentRetirementStore,
  RetirementConversionLeg,
  RetirementTransferLeg,
} from "@/lib/agent-retirement";
import type { ParticleTransactionStatusRead } from "@/lib/ua/particle-finality";
import type { UAClient } from "@/lib/ua/types";
import { ARBITRUM_CHAIN_ID } from "@/lib/verbs/chains";

/** Read-only finality attempts before an unresolved leg needs attention. */
export const MAX_RETIREMENT_FINALITY_ATTEMPTS = 5;

function isTerminalRetirementLegStatus(status: string): boolean {
  return status === "complete" || status === "skipped";
}

export type RetirementLegFinality = {
  outcome: ExecutionOutcome | null;
  providerStatus: string | null;
  attemptCount: number;
  submittedAt: string | null;
  confirmedAt: string | null;
  confirmedHashes: Array<{
    legId: string;
    kind: ExecutionLeg["kind"];
    chainId: number;
    chainName: string;
    confirmedHash: string;
    explorerUrl: string | null;
  }>;
  providerEvidence: ExecutionProviderEvidence[];
};

export function emptyRetirementLegFinality(): RetirementLegFinality {
  return {
    outcome: null,
    providerStatus: null,
    attemptCount: 0,
    submittedAt: null,
    confirmedAt: null,
    confirmedHashes: [],
    providerEvidence: [],
  };
}

export function acceptedRetirementLegFinality(
  current: RetirementLegFinality,
  transactionId: string,
  at: string,
): RetirementLegFinality {
  return {
    ...current,
    outcome: "submitted",
    providerStatus: "ACCEPTED",
    submittedAt: current.submittedAt ?? at,
    providerEvidence: [
      ...current.providerEvidence,
      {
        observedAt: at,
        attempt: current.attemptCount,
        providerStatus: "ACCEPTED",
        normalizedStatus: "submitted",
        legId: null,
        transactionId,
        confirmedHash: null,
        error: null,
        raw: { transactionId },
      },
    ],
  };
}

function confirmedHashesFromRead(
  read: ParticleTransactionStatusRead,
): RetirementLegFinality["confirmedHashes"] {
  return read.legs.flatMap((leg) =>
    leg.status === "finalized" && leg.confirmedHash
      ? [
          {
            legId: leg.legId,
            kind: leg.kind,
            chainId: leg.chainId,
            chainName: leg.chainName,
            confirmedHash: leg.confirmedHash,
            explorerUrl: leg.explorerUrl,
          },
        ]
      : [],
  );
}

function finalityAttentionMessage(
  read: ParticleTransactionStatusRead,
  attempt: number,
): string {
  if (read.error) return read.error;
  if (read.outcome === "partial") {
    return "Particle confirmed only part of the retirement transaction.";
  }
  if (read.outcome === "failed") {
    return "Particle reported that the retirement transaction failed.";
  }
  if (read.outcome === "needs_attention") {
    return "Particle returned inconsistent retirement finality evidence.";
  }
  return `Particle retirement finality remained unresolved after ${attempt} read-only attempts.`;
}

export function updateLegInRecord(
  retirement: AgentRetirementRecord,
  legId: string,
  update: (
    leg: RetirementConversionLeg | RetirementTransferLeg,
  ) => RetirementConversionLeg | RetirementTransferLeg,
): AgentRetirementRecord {
  const conversionIndex = retirement.conversionLegs.findIndex(
    (leg) => leg.legId === legId,
  );
  if (conversionIndex >= 0) {
    const conversionLegs = [...retirement.conversionLegs];
    conversionLegs[conversionIndex] = update(
      conversionLegs[conversionIndex]!,
    ) as RetirementConversionLeg;
    return { ...retirement, conversionLegs };
  }
  if (retirement.transferLeg?.legId === legId) {
    return {
      ...retirement,
      transferLeg: update(retirement.transferLeg) as RetirementTransferLeg,
    };
  }
  throw new Error(`Unknown retirement leg ${legId}.`);
}

/**
 * Reconcile one already-submitted retirement leg from Particle's read-only
 * status seam. This function never signs, requotes, or submits.
 */
export async function reconcileRetirementLegFinality(options: {
  retirementStore: AgentRetirementStore;
  retirement: AgentRetirementRecord;
  legId: string;
  ua: Pick<UAClient, "getTransactionStatus">;
  now?: Date;
  maxAttempts?: number;
  claimToken?: string;
}): Promise<AgentRetirementRecord> {
  if (!options.claimToken) {
    const claimToken = randomUUID();
    const claimed = await options.retirementStore.claimRecovery({
      retirementId: options.retirement.retirementId,
      claimToken,
      now: options.now ?? new Date(),
    });
    if (!claimed) {
      return (
        (await options.retirementStore.get(
          options.retirement.retirementId,
        )) ?? options.retirement
      );
    }
    try {
      return await reconcileRetirementLegFinality({
        ...options,
        retirement: claimed,
        claimToken,
      });
    } finally {
      await options.retirementStore.releaseRecovery({
        retirementId: options.retirement.retirementId,
        claimToken,
      });
    }
  }

  const target =
    options.retirement.conversionLegs.find(
      (leg) => leg.legId === options.legId,
    ) ??
    (options.retirement.transferLeg?.legId === options.legId
      ? options.retirement.transferLeg
      : null);
  if (!target) throw new Error(`Unknown retirement leg ${options.legId}.`);
  if (
    isTerminalRetirementLegStatus(target.status) ||
    target.status === "needs_attention"
  ) {
    return options.retirement;
  }
  if (
    target.status !== "in_flight" &&
    target.status !== "submitted"
  ) {
    return options.retirement;
  }
  if (!target.transactionId) {
    const at = (options.now ?? new Date()).toISOString();
    const updated = updateLegInRecord(
      options.retirement,
      target.legId,
      (leg) => ({
        ...leg,
        status: "needs_attention",
        error: "Retirement leg has no bound Particle transaction identity.",
        finality: {
          ...leg.finality,
          outcome: "needs_attention",
        },
      }),
    );
    return options.retirementStore.update({
      ...updated,
      reconciliationState: "needs_attention",
      lastError: "Retirement leg has no bound Particle transaction identity.",
      updatedAt: at,
    });
  }

  const observedAt = (options.now ?? new Date()).toISOString();
  let read: ParticleTransactionStatusRead;
  try {
    read = await options.ua.getTransactionStatus(target.transactionId);
  } catch (error) {
    read = {
      transactionId: target.transactionId,
      providerStatus: null,
      outcome: "pending",
      legs: [],
      retrySafe: true,
      error:
        error instanceof Error
          ? error.message
          : "Particle transaction-status lookup failed.",
      raw: null,
    };
  }

  const attempt = target.finality.attemptCount + 1;
  const evidence = [
    ...target.finality.providerEvidence,
    ...particleReadEvidence(read, attempt, observedAt),
  ];
  const confirmedHashes = confirmedHashesFromRead(read);
  const required = read.legs.filter((leg) => leg.required);
  const allRequiredConfirmed =
    required.length > 0 &&
    required.every(
      (leg) => leg.status === "finalized" && Boolean(leg.confirmedHash),
    );
  const hasConfirmedDestination = required.some(
    (leg) =>
      leg.chainId === ARBITRUM_CHAIN_ID &&
      leg.status === "finalized" &&
      Boolean(leg.confirmedHash),
  );
  const maxAttempts =
    options.maxAttempts ?? MAX_RETIREMENT_FINALITY_ATTEMPTS;
  const decision = decideFinalityFromParticleRead({
    read,
    attempt,
    maxAttempts,
    acceptFinalized: allRequiredConfirmed && hasConfirmedDestination,
    currentOutcome: read.outcome,
  });
  const finalized = decision.kind === "finalized";
  const terminalAttention = decision.kind === "needs_attention";

  let next = updateLegInRecord(
    options.retirement,
    target.legId,
    (leg) => {
      const receiptId = finalized
        ? confirmedHashes.at(-1)?.confirmedHash ?? null
        : null;
      return {
        ...leg,
        status: finalized
          ? "complete"
          : terminalAttention
            ? "needs_attention"
            : "submitted",
        receiptId,
        error: terminalAttention
          ? finalityAttentionMessage(read, attempt)
          : read.error,
        finality: {
          outcome: finalized
            ? "finalized"
            : terminalAttention
              ? read.outcome === "submitted" || read.outcome === "pending"
                ? "needs_attention"
                : read.outcome
              : read.outcome,
          providerStatus: read.providerStatus,
          attemptCount: attempt,
          submittedAt: leg.finality.submittedAt ?? observedAt,
          confirmedAt: finalized ? observedAt : null,
          confirmedHashes: finalized
            ? confirmedHashes
            : [
                ...leg.finality.confirmedHashes,
                ...confirmedHashes.filter(
                  (candidate) =>
                    !leg.finality.confirmedHashes.some(
                      (existing) =>
                        existing.confirmedHash === candidate.confirmedHash,
                    ),
                ),
              ],
          providerEvidence: evidence,
        },
      };
    },
  );

  const nextTarget =
    next.conversionLegs.find((leg) => leg.legId === target.legId) ??
    next.transferLeg;
  if (finalized && target.kind === "transfer") {
    const amountUsd = Number(target.amount ?? 0);
    next = {
      ...next,
      recoveredUsd:
        next.recoveredUsd +
        (Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0),
    };
  }
  const error = nextTarget?.error ?? null;
  return options.retirementStore.update({
    ...next,
    reconciliationState: terminalAttention
      ? "needs_attention"
      : "pending_sync",
    lastError: error,
    updatedAt: observedAt,
  });
}
