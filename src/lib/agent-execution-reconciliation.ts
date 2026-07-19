import "server-only";

import {
  createExecutionFinalityRecord,
  type ExecutionFinalityRecord,
  type ExecutionFinalityStore,
  type ExecutionLeg,
  type ExecutionLegStatus,
  type ExecutionProviderEvidence,
  type OperatorRecoveryGuidance,
} from "@/lib/agent-execution-finality";
import type { UAClient } from "@/lib/ua/types";
import type { ParticleTransactionStatusRead } from "@/lib/ua/particle-finality";
import type { RawTransaction } from "@/lib/ua/trade";
import { chainName } from "@/lib/verbs/chains";

export const MAX_EXECUTION_RECONCILIATION_ATTEMPTS = 5;

export type ExecutionWorkflowStarter = {
  start(
    executionId: string,
    ownerAddress: string,
  ): Promise<{ runId: string }>;
};

export type ExecutionReconciler = {
  reconcile(executionId: string): Promise<ExecutionFinalityRecord>;
};

function plannedLegs(raw: RawTransaction, at: string): ExecutionLeg[] {
  const userOps = raw.userOps ?? [];
  return userOps.map((operation, index) => ({
    legId: `planned:${operation.chainId}:${index}`,
    kind:
      userOps.length === 1
        ? "destination"
        : index === 0
          ? "source"
          : index === userOps.length - 1
            ? "destination"
            : "bridge",
    chainId: operation.chainId,
    chainName: chainName(operation.chainId),
    required: true,
    status: "submitted",
    confirmedHash: null,
    attemptCount: 0,
    lastProviderStatus: null,
    lastError: null,
    submittedAt: null,
    confirmedAt: null,
    updatedAt: at,
    providerEvidence: [],
  }));
}

export function createPreSubmissionExecution(input: {
  executionId: string;
  agentId: string;
  permitId: string;
  quoteId: string;
  idempotencyKey: string;
  rawTransaction: RawTransaction;
  correlationId?: string | null;
  createdAt: string;
}): ExecutionFinalityRecord {
  const transactionId = input.rawTransaction.transactionId?.trim();
  if (!transactionId) {
    throw new Error(
      "Stored raw transaction is missing its planned Particle transaction identity.",
    );
  }
  return createExecutionFinalityRecord({
    executionId: input.executionId,
    agentId: input.agentId,
    permitId: input.permitId,
    quoteId: input.quoteId,
    idempotencyKey: input.idempotencyKey,
    particleTransactionId: transactionId,
    outcome: "pending",
    legs: plannedLegs(input.rawTransaction, input.createdAt),
    workflowCorrelationId: input.correlationId ?? null,
    createdAt: input.createdAt,
  });
}

function responseEvidence(input: {
  record: ExecutionFinalityRecord;
  observedAt: string;
  providerStatus: string | null;
  normalizedStatus: "submitted" | "pending" | null;
  error: string | null;
  raw: unknown;
}): ExecutionProviderEvidence {
  return {
    observedAt: input.observedAt,
    attempt: input.record.attemptCount,
    providerStatus: input.providerStatus,
    normalizedStatus: input.normalizedStatus,
    legId: null,
    transactionId: input.record.particleTransactionId,
    confirmedHash: null,
    error: input.error,
    raw: input.raw,
  };
}

async function transitionCurrent(
  store: ExecutionFinalityStore,
  executionId: string,
  update: (
    current: ExecutionFinalityRecord,
  ) => {
    to: ExecutionFinalityRecord["outcome"];
    at: string;
    patch: Parameters<ExecutionFinalityStore["transition"]>[0]["patch"];
  } | null,
): Promise<ExecutionFinalityRecord> {
  for (;;) {
    const current = await store.get(executionId);
    if (!current) throw new Error(`Execution ${executionId} was not found.`);
    const next = update(current);
    if (!next) return current;
    const saved = await store.transition({
      executionId,
      expectedVersion: current.version,
      from: current.outcome,
      to: next.to,
      updatedAt: next.at,
      ...(next.patch ? { patch: next.patch } : {}),
    });
    if (saved) return saved;
  }
}

export async function attachExecutionWorkflowRun(input: {
  store: ExecutionFinalityStore;
  executionId: string;
  runId: string;
  at: string;
}): Promise<ExecutionFinalityRecord> {
  return transitionCurrent(input.store, input.executionId, (current) => {
    if (current.workflowRunId) return null;
    return {
      to: current.outcome,
      at: input.at,
      patch: { workflowRunId: input.runId },
    };
  });
}

export async function markExecutionSubmitted(input: {
  store: ExecutionFinalityStore;
  executionId: string;
  transactionId: string;
  at: string;
}): Promise<ExecutionFinalityRecord> {
  return transitionCurrent(input.store, input.executionId, (current) => {
    if (
      current.outcome === "finalized" ||
      current.outcome === "needs_attention"
    ) {
      return null;
    }
    if (
      current.particleTransactionId &&
      current.particleTransactionId !== input.transactionId
    ) {
      return {
        to: "needs_attention",
        at: input.at,
        patch: {
          lastError: `Particle accepted transaction ${input.transactionId}, but the stored transaction identity is ${current.particleTransactionId}.`,
          providerEvidence: [
            ...current.providerEvidence,
            responseEvidence({
              record: current,
              observedAt: input.at,
              providerStatus: "ACCEPTED_IDENTITY_MISMATCH",
              normalizedStatus: null,
              error: "Particle returned a different transaction identity.",
              raw: { transactionId: input.transactionId },
            }),
          ],
          operatorRecovery: recoveryGuidance(
            current,
            "Particle returned a different transaction identity after submission.",
          ),
        },
      };
    }
    return {
      to: current.outcome === "pending" ? "pending" : "submitted",
      at: input.at,
      patch: {
        submittedAt: current.submittedAt ?? input.at,
        lastProviderStatus: "ACCEPTED",
        lastError: null,
        legs: current.legs.map((leg) => ({
          ...leg,
          submittedAt: leg.submittedAt ?? input.at,
          updatedAt: input.at,
        })),
        providerEvidence: [
          ...current.providerEvidence,
          responseEvidence({
            record: current,
            observedAt: input.at,
            providerStatus: "ACCEPTED",
            normalizedStatus: "submitted",
            error: null,
            raw: { transactionId: input.transactionId },
          }),
        ],
      },
    };
  });
}

export async function markExecutionSubmissionUncertain(input: {
  store: ExecutionFinalityStore;
  executionId: string;
  error: unknown;
  at: string;
}): Promise<ExecutionFinalityRecord> {
  const message =
    input.error instanceof Error
      ? input.error.message
      : "Particle submission ended without a definitive response.";
  return transitionCurrent(input.store, input.executionId, (current) => {
    if (
      current.outcome === "finalized" ||
      current.outcome === "needs_attention"
    ) {
      return null;
    }
    return {
      to: current.outcome === "submitted" ? "pending" : current.outcome,
      at: input.at,
      patch: {
        lastError: message,
        providerEvidence: [
          ...current.providerEvidence,
          responseEvidence({
            record: current,
            observedAt: input.at,
            providerStatus: null,
            normalizedStatus: "pending",
            error: message,
            raw: null,
          }),
        ],
      },
    };
  });
}

function recoveryGuidance(
  record: ExecutionFinalityRecord,
  summary: string,
): OperatorRecoveryGuidance {
  return {
    summary,
    affectedLegIds: record.legs
      .filter((leg) => leg.status !== "finalized")
      .map((leg) => leg.legId),
    steps: [
      "Inspect the stored Particle provider snapshots and confirmed hashes.",
      "Resolve stranded or failed legs manually; never resubmit the stored signed transaction.",
      "Resume read-only reconciliation after the provider or manual recovery state changes.",
    ],
  };
}

const STATUS_RANK: Record<ExecutionLegStatus, number> = {
  submitted: 0,
  pending: 1,
  finalized: 2,
  failed: 2,
  needs_attention: 3,
};

function nonRegressingStatus(
  current: ExecutionLegStatus,
  observed: ExecutionLegStatus,
): ExecutionLegStatus {
  if (current === "finalized" || current === "needs_attention") return current;
  if (current === "failed" && observed !== "needs_attention") return current;
  return STATUS_RANK[observed] >= STATUS_RANK[current] ? observed : current;
}

function mergeObservedLegs(
  current: ExecutionFinalityRecord,
  read: ParticleTransactionStatusRead,
  attempt: number,
  at: string,
): ExecutionLeg[] {
  const claimed = new Set<string>();
  const updated = current.legs.map((leg) => ({ ...leg }));

  for (const observed of read.legs) {
    let target = updated.find(
      (leg) =>
        !claimed.has(leg.legId) &&
        leg.chainId === observed.chainId &&
        (leg.kind === observed.kind || leg.kind === "unknown"),
    );
    target ??= updated.find(
      (leg) => !claimed.has(leg.legId) && leg.chainId === observed.chainId,
    );
    if (!target) {
      target = {
        legId: observed.legId,
        kind: observed.kind,
        chainId: observed.chainId,
        chainName: observed.chainName,
        required: observed.required,
        status: "submitted",
        confirmedHash: null,
        attemptCount: 0,
        lastProviderStatus: null,
        lastError: null,
        submittedAt: current.submittedAt,
        confirmedAt: null,
        updatedAt: at,
        providerEvidence: [],
      };
      updated.push(target);
    }
    claimed.add(target.legId);
    const evidence: ExecutionProviderEvidence = {
      observedAt: at,
      attempt,
      providerStatus: observed.providerStatus,
      normalizedStatus: read.outcome,
      legId: target.legId,
      transactionId: read.transactionId,
      confirmedHash: observed.confirmedHash,
      error: observed.error,
      raw: observed.raw,
    };
    target.status = nonRegressingStatus(target.status, observed.status);
    target.confirmedHash =
      target.confirmedHash ?? observed.confirmedHash;
    target.attemptCount = attempt;
    target.lastProviderStatus = observed.providerStatus;
    target.lastError = observed.error;
    target.submittedAt = target.submittedAt ?? current.submittedAt ?? at;
    target.confirmedAt =
      target.confirmedAt ??
      (target.status === "finalized" ? at : null);
    target.updatedAt = at;
    target.providerEvidence = [...target.providerEvidence, evidence];
  }
  return updated;
}

function readEvidence(
  read: ParticleTransactionStatusRead,
  attempt: number,
  at: string,
): ExecutionProviderEvidence {
  return {
    observedAt: at,
    attempt,
    providerStatus: read.providerStatus,
    normalizedStatus: read.outcome,
    legId: null,
    transactionId: read.transactionId,
    confirmedHash: null,
    error: read.error,
    raw: read.raw,
  };
}

function transitionForRead(input: {
  current: ExecutionFinalityRecord;
  read: ParticleTransactionStatusRead;
  at: string;
  maxAttempts: number;
}) {
  const attempt = input.current.attemptCount + 1;
  const legs = mergeObservedLegs(
    input.current,
    input.read,
    attempt,
    input.at,
  );
  const allRequiredFinalized =
    legs.some((leg) => leg.required) &&
    legs.every((leg) => !leg.required || leg.status === "finalized");
  const evidence = [
    ...input.current.providerEvidence,
    readEvidence(input.read, attempt, input.at),
  ];
  const basePatch = {
    legs,
    providerEvidence: evidence,
    attemptCount: attempt,
    lastProviderStatus: input.read.providerStatus,
    lastError: input.read.error,
  };

  if (input.read.outcome === "finalized" && allRequiredFinalized) {
    return { to: "finalized" as const, patch: basePatch };
  }

  const requiredLegs = legs.filter((leg) => leg.required);
  const hasConfirmedSuccess = requiredLegs.some(
    (leg) => leg.status === "finalized" && Boolean(leg.confirmedHash),
  );
  const allRequiredTerminal =
    requiredLegs.length > 0 &&
    requiredLegs.every(
      (leg) => leg.status === "finalized" || leg.status === "failed",
    );
  if (input.read.outcome === "partial" && hasConfirmedSuccess) {
    return { to: "partial" as const, patch: basePatch };
  }
  if (
    input.read.outcome === "failed" &&
    allRequiredTerminal &&
    !hasConfirmedSuccess
  ) {
    return { to: "failed" as const, patch: basePatch };
  }

  const nonRetryable =
    !input.read.retrySafe ||
    input.read.outcome === "partial" ||
    input.read.outcome === "failed" ||
    input.read.outcome === "needs_attention" ||
    (input.read.outcome === "finalized" && !allRequiredFinalized);
  const exhausted = attempt >= input.maxAttempts;
  if (nonRetryable || exhausted) {
    const summary = nonRetryable
      ? input.read.error ??
        `Particle returned non-retryable ${input.read.outcome} finality.`
      : `Particle finality remained unresolved after ${attempt} read-only attempts.`;
    return {
      to: "needs_attention" as const,
      patch: {
        ...basePatch,
        lastError: summary,
        operatorRecovery: recoveryGuidance(
          { ...input.current, legs },
          summary,
        ),
      },
    };
  }

  return {
    to:
      input.current.outcome === "pending" ||
      input.read.outcome === "pending"
        ? ("pending" as const)
        : ("submitted" as const),
    patch: basePatch,
  };
}

export function createExecutionReconciler(options: {
  store: ExecutionFinalityStore;
  ua: Pick<UAClient, "getTransactionStatus">;
  maxAttempts?: number;
  now?: () => Date;
}): ExecutionReconciler {
  const maxAttempts =
    options.maxAttempts ?? MAX_EXECUTION_RECONCILIATION_ATTEMPTS;
  return {
    async reconcile(executionId) {
      const initial = await options.store.get(executionId);
      if (!initial) throw new Error(`Execution ${executionId} was not found.`);
      if (
        initial.outcome === "finalized" ||
        initial.outcome === "partial" ||
        initial.outcome === "failed" ||
        initial.outcome === "needs_attention"
      ) {
        return initial;
      }
      if (!initial.particleTransactionId) {
        return transitionCurrent(options.store, executionId, (current) => ({
          to: "needs_attention",
          at: (options.now?.() ?? new Date()).toISOString(),
          patch: {
            lastError: "Execution has no Particle transaction identity.",
            operatorRecovery: recoveryGuidance(
              current,
              "Execution has no Particle transaction identity.",
            ),
          },
        }));
      }

      let read: ParticleTransactionStatusRead;
      try {
        read = await options.ua.getTransactionStatus(
          initial.particleTransactionId,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Particle transaction-status lookup failed.";
        read = {
          transactionId: initial.particleTransactionId,
          providerStatus: null,
          outcome: "pending",
          legs: [],
          retrySafe: true,
          error: message,
          raw: null,
        };
      }

      return transitionCurrent(options.store, executionId, (current) => {
        if (
          current.outcome === "finalized" ||
          current.outcome === "needs_attention"
        ) {
          return null;
        }
        const transition = transitionForRead({
          current,
          read,
          at: (options.now?.() ?? new Date()).toISOString(),
          maxAttempts,
        });
        return {
          to: transition.to,
          at: (options.now?.() ?? new Date()).toISOString(),
          patch: transition.patch,
        };
      });
    },
  };
}

export async function runExecutionReconciliationRetries(input: {
  executionId: string;
  reconcile: ExecutionReconciler;
  delayMs?: number;
}): Promise<ExecutionFinalityRecord> {
  let latest = await input.reconcile.reconcile(input.executionId);
  while (
    latest.outcome !== "finalized" &&
    latest.outcome !== "partial" &&
    latest.outcome !== "failed" &&
    latest.outcome !== "needs_attention"
  ) {
    if (input.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    latest = await input.reconcile.reconcile(input.executionId);
  }
  return latest;
}
