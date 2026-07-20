// Shared, pure decision policy translating a normalized Particle transaction
// read into a terminal-vs-continue finality decision. Used by both the
// execution reconciler and retirement leg reconciliation so the four-way
// terminal split lives in exactly one place. This module never signs, requotes,
// or submits — it only interprets read-only provider evidence.

import type {
  ExecutionOutcome,
  ExecutionProviderEvidence,
} from "@/lib/agent-execution-finality";
import type { ParticleTransactionStatusRead } from "@/lib/ua/particle-finality";

export type ParticleFinalityDecision =
  | { kind: "finalized" }
  | { kind: "partial" }
  | { kind: "failed" }
  | { kind: "needs_attention"; reason: string }
  | { kind: "continue"; nextOutcome: "submitted" | "pending" };

export function decideFinalityFromParticleRead(input: {
  read: ParticleTransactionStatusRead;
  attempt: number;
  maxAttempts: number;
  /** When outcome is finalized, extra gate before accepting (e.g. all required legs confirmed). */
  acceptFinalized: boolean;
  /** Execution path: partial with some confirmed success. */
  hasConfirmedSuccess?: boolean;
  /** Execution path: all required legs terminal (finalized|failed). */
  allRequiredTerminal?: boolean;
  /** Current outcome for the continue branch. */
  currentOutcome?: "submitted" | "pending" | ExecutionOutcome;
}): ParticleFinalityDecision {
  const { read, attempt, maxAttempts } = input;

  if (read.outcome === "finalized" && input.acceptFinalized) {
    return { kind: "finalized" };
  }
  if (read.outcome === "partial" && input.hasConfirmedSuccess) {
    return { kind: "partial" };
  }
  if (
    read.outcome === "failed" &&
    input.allRequiredTerminal &&
    !input.hasConfirmedSuccess
  ) {
    return { kind: "failed" };
  }

  const nonRetryable =
    !read.retrySafe ||
    read.outcome === "partial" ||
    read.outcome === "failed" ||
    read.outcome === "needs_attention" ||
    (read.outcome === "finalized" && !input.acceptFinalized);
  const exhausted = attempt >= maxAttempts;
  if (nonRetryable || exhausted) {
    const reason = nonRetryable
      ? read.error ??
        `Particle returned non-retryable ${read.outcome} finality.`
      : `Particle finality remained unresolved after ${attempt} read-only attempts.`;
    return { kind: "needs_attention", reason };
  }

  return {
    kind: "continue",
    nextOutcome:
      input.currentOutcome === "pending" || read.outcome === "pending"
        ? "pending"
        : "submitted",
  };
}

/** Durable evidence for a Particle read: one root snapshot plus one per leg. */
export function particleReadEvidence(
  read: ParticleTransactionStatusRead,
  attempt: number,
  observedAt: string,
): ExecutionProviderEvidence[] {
  return [
    {
      observedAt,
      attempt,
      providerStatus: read.providerStatus,
      normalizedStatus: read.outcome,
      legId: null,
      transactionId: read.transactionId,
      confirmedHash: null,
      error: read.error,
      raw: read.raw,
    },
    ...read.legs.map((leg) => ({
      observedAt,
      attempt,
      providerStatus: leg.providerStatus,
      normalizedStatus: read.outcome,
      legId: leg.legId,
      transactionId: read.transactionId,
      confirmedHash: leg.confirmedHash,
      error: leg.error,
      raw: leg.raw,
    })),
  ];
}
