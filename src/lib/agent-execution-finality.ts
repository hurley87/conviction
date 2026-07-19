// Durable execution-finality state for Particle value-moving operations.
// Submission and reconciliation are intentionally kept outside this module.

export const EXECUTION_OUTCOMES = [
  "submitted",
  "pending",
  "finalized",
  "partial",
  "failed",
  "needs_attention",
] as const;

export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];

export const EXECUTION_LEG_STATUSES = [
  "submitted",
  "pending",
  "finalized",
  "failed",
  "needs_attention",
] as const;

export type ExecutionLegStatus = (typeof EXECUTION_LEG_STATUSES)[number];

export type ExecutionLegKind =
  | "source"
  | "bridge"
  | "destination"
  | "conversion"
  | "transfer"
  | "unknown";

export type ExecutionProviderEvidence = {
  observedAt: string;
  attempt: number;
  /** Provider-native status before normalization. */
  providerStatus: string | null;
  normalizedStatus: ExecutionOutcome | null;
  /** Associates evidence with a leg when Particle exposes that relationship. */
  legId: string | null;
  transactionId: string | null;
  confirmedHash: string | null;
  error: string | null;
  /** Lossless provider response retained for later diagnosis/re-normalization. */
  raw: unknown;
};

export type ExecutionLeg = {
  legId: string;
  kind: ExecutionLegKind;
  chainId: number;
  chainName: string;
  required: boolean;
  status: ExecutionLegStatus;
  confirmedHash: string | null;
  attemptCount: number;
  lastProviderStatus: string | null;
  lastError: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  providerEvidence: ExecutionProviderEvidence[];
};

export type OperatorRecoveryGuidance = {
  summary: string;
  affectedLegIds: string[];
  steps: string[];
};

export type ExecutionFinalityRecord = {
  executionId: string;
  agentId: string;
  permitId: string;
  quoteId: string;
  idempotencyKey: string;
  /** Particle transaction ID; bound at most once after durable pre-submit save. */
  particleTransactionId: string | null;
  outcome: ExecutionOutcome;
  legs: ExecutionLeg[];
  providerEvidence: ExecutionProviderEvidence[];
  attemptCount: number;
  lastProviderStatus: string | null;
  lastError: string | null;
  workflowCorrelationId: string | null;
  workflowRunId: string | null;
  operatorRecovery: OperatorRecoveryGuidance | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
  /** Monotonic optimistic-lock version used by every mutation. */
  version: number;
};

export type CreateExecutionFinalityInput = {
  executionId: string;
  agentId: string;
  permitId: string;
  quoteId: string;
  idempotencyKey: string;
  particleTransactionId?: string | null;
  outcome?: "submitted" | "pending";
  legs: ExecutionLeg[];
  providerEvidence?: ExecutionProviderEvidence[];
  workflowCorrelationId?: string | null;
  workflowRunId?: string | null;
  createdAt: string;
};

export type ExecutionTransitionPatch = {
  legs?: ExecutionLeg[];
  providerEvidence?: ExecutionProviderEvidence[];
  attemptCount?: number;
  lastProviderStatus?: string | null;
  lastError?: string | null;
  workflowCorrelationId?: string | null;
  workflowRunId?: string | null;
  operatorRecovery?: OperatorRecoveryGuidance | null;
  submittedAt?: string | null;
  finalizedAt?: string | null;
};

export type TransitionExecutionInput = {
  executionId: string;
  expectedVersion: number;
  from: ExecutionOutcome;
  to: ExecutionOutcome;
  updatedAt: string;
  patch?: ExecutionTransitionPatch;
};

export type BindParticleTransactionInput = {
  executionId: string;
  expectedVersion: number;
  particleTransactionId: string;
  updatedAt: string;
};

export type ExecutionFinalityExport = {
  schemaVersion: 1;
  records: ExecutionFinalityRecord[];
};

export type ExecutionFinalityStore = {
  create(record: ExecutionFinalityRecord): Promise<ExecutionFinalityRecord>;
  get(executionId: string): Promise<ExecutionFinalityRecord | null>;
  getByAgentIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionFinalityRecord | null>;
  getByPermitId(permitId: string): Promise<ExecutionFinalityRecord | null>;
  getByQuoteId(quoteId: string): Promise<ExecutionFinalityRecord | null>;
  getByParticleTransactionId(
    particleTransactionId: string,
  ): Promise<ExecutionFinalityRecord | null>;
  bindParticleTransaction(
    input: BindParticleTransactionInput,
  ): Promise<ExecutionFinalityRecord | null>;
  transition(
    input: TransitionExecutionInput,
  ): Promise<ExecutionFinalityRecord | null>;
};

export class ExecutionFinalityConflictError extends Error {
  constructor(
    public readonly field:
      | "executionId"
      | "agentIdempotency"
      | "permitId"
      | "quoteId"
      | "particleTransactionId",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionFinalityConflictError";
  }
}

const LEGAL_TRANSITIONS: Record<ExecutionOutcome, ReadonlySet<ExecutionOutcome>> =
  {
    submitted: new Set([
      "submitted",
      "pending",
      "finalized",
      "partial",
      "failed",
      "needs_attention",
    ]),
    pending: new Set([
      "pending",
      "finalized",
      "partial",
      "failed",
      "needs_attention",
    ]),
    finalized: new Set(),
    partial: new Set(["partial", "needs_attention"]),
    failed: new Set(["failed", "needs_attention"]),
    needs_attention: new Set(),
  };

const LEGAL_LEG_TRANSITIONS: Record<
  ExecutionLegStatus,
  ReadonlySet<ExecutionLegStatus>
> = {
  submitted: new Set([
    "submitted",
    "pending",
    "finalized",
    "failed",
    "needs_attention",
  ]),
  pending: new Set([
    "pending",
    "finalized",
    "failed",
    "needs_attention",
  ]),
  finalized: new Set(["finalized"]),
  failed: new Set(["failed", "needs_attention"]),
  needs_attention: new Set(["needs_attention"]),
};

export function isLegalExecutionTransition(
  from: ExecutionOutcome,
  to: ExecutionOutcome,
): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

export function cloneExecutionFinalityRecord(
  record: ExecutionFinalityRecord,
): ExecutionFinalityRecord {
  return durableClone(record);
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty.`);
  return normalized;
}

/** Match Neon jsonb durability instead of retaining memory-only JS values. */
function durableClone<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Execution finality state must be JSON-serializable.");
  }
  return JSON.parse(serialized) as T;
}

export function assertValidExecutionFinalityRecord(
  record: ExecutionFinalityRecord,
): void {
  nonEmpty(record.executionId, "executionId");
  nonEmpty(record.agentId, "agentId");
  nonEmpty(record.permitId, "permitId");
  nonEmpty(record.quoteId, "quoteId");
  nonEmpty(record.idempotencyKey, "idempotencyKey");
  if (record.particleTransactionId !== null) {
    nonEmpty(record.particleTransactionId, "particleTransactionId");
  }
  if (!EXECUTION_OUTCOMES.includes(record.outcome)) {
    throw new Error(`Unsupported execution outcome: ${record.outcome}`);
  }
  if (!Number.isInteger(record.version) || record.version < 1) {
    throw new Error("Execution version must be a positive integer.");
  }
  if (!Number.isInteger(record.attemptCount) || record.attemptCount < 0) {
    throw new Error("Execution attemptCount must be a non-negative integer.");
  }
  const legIds = new Set<string>();
  for (const leg of record.legs) {
    nonEmpty(leg.legId, "legId");
    if (legIds.has(leg.legId)) {
      throw new Error(`Duplicate execution leg ${leg.legId}.`);
    }
    legIds.add(leg.legId);
    if (!Number.isInteger(leg.chainId) || leg.chainId <= 0) {
      throw new Error(`Execution leg ${leg.legId} has an invalid chainId.`);
    }
    if (!EXECUTION_LEG_STATUSES.includes(leg.status)) {
      throw new Error(`Execution leg ${leg.legId} has an invalid status.`);
    }
    if (!Number.isInteger(leg.attemptCount) || leg.attemptCount < 0) {
      throw new Error(
        `Execution leg ${leg.legId} has an invalid attemptCount.`,
      );
    }
  }
  if (
    record.outcome === "finalized" &&
    record.legs.some((leg) => leg.required && leg.status !== "finalized")
  ) {
    throw new Error(
      "A finalized execution requires every required leg to be finalized.",
    );
  }
  if (record.outcome === "needs_attention" && !record.operatorRecovery) {
    throw new Error(
      "A needs_attention execution requires operator recovery guidance.",
    );
  }
}

export function createExecutionFinalityRecord(
  input: CreateExecutionFinalityInput,
): ExecutionFinalityRecord {
  const outcome = input.outcome ?? "submitted";
  const record: ExecutionFinalityRecord = {
    executionId: nonEmpty(input.executionId, "executionId"),
    agentId: nonEmpty(input.agentId, "agentId"),
    permitId: nonEmpty(input.permitId, "permitId"),
    quoteId: nonEmpty(input.quoteId, "quoteId"),
    idempotencyKey: nonEmpty(input.idempotencyKey, "idempotencyKey"),
    particleTransactionId: input.particleTransactionId?.trim() || null,
    outcome,
    legs: durableClone(input.legs),
    providerEvidence: durableClone(input.providerEvidence ?? []),
    attemptCount: 0,
    lastProviderStatus: null,
    lastError: null,
    workflowCorrelationId: input.workflowCorrelationId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    operatorRecovery: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    submittedAt: outcome === "submitted" ? input.createdAt : null,
    finalizedAt: null,
    version: 1,
  };
  assertValidExecutionFinalityRecord(record);
  return record;
}

function sameIdentity(
  left: ExecutionFinalityRecord,
  right: ExecutionFinalityRecord,
): boolean {
  return (
    left.agentId === right.agentId &&
    left.idempotencyKey === right.idempotencyKey &&
    left.permitId === right.permitId &&
    left.quoteId === right.quoteId &&
    (left.particleTransactionId === null ||
      right.particleTransactionId === null ||
      left.particleTransactionId === right.particleTransactionId)
  );
}

export function resolveIdempotentCreate(
  existing: ExecutionFinalityRecord,
  proposed: ExecutionFinalityRecord,
): ExecutionFinalityRecord {
  if (!sameIdentity(existing, proposed)) {
    throw new ExecutionFinalityConflictError(
      "agentIdempotency",
      "The agent/idempotency identity is already bound to another execution.",
    );
  }
  return cloneExecutionFinalityRecord(existing);
}

export function applyExecutionTransition(
  current: ExecutionFinalityRecord,
  input: TransitionExecutionInput,
): ExecutionFinalityRecord | null {
  if (
    current.version !== input.expectedVersion ||
    current.outcome !== input.from
  ) {
    return null;
  }
  if (!isLegalExecutionTransition(input.from, input.to)) {
    throw new Error(
      `Illegal execution transition ${input.from} -> ${input.to}.`,
    );
  }
  const patch = input.patch ?? {};
  const next: ExecutionFinalityRecord = {
    ...current,
    ...patch,
    legs: patch.legs
      ? durableClone(patch.legs)
      : durableClone(current.legs),
    providerEvidence: patch.providerEvidence
      ? durableClone(patch.providerEvidence)
      : durableClone(current.providerEvidence),
    operatorRecovery:
      patch.operatorRecovery !== undefined
        ? durableClone(patch.operatorRecovery)
        : durableClone(current.operatorRecovery),
    outcome: input.to,
    updatedAt: input.updatedAt,
    finalizedAt:
      patch.finalizedAt !== undefined
        ? patch.finalizedAt
        : input.to === "finalized"
          ? input.updatedAt
          : current.finalizedAt,
    version: current.version + 1,
  };
  if (next.attemptCount < current.attemptCount) {
    throw new Error("Execution attemptCount cannot decrease.");
  }
  assertEvidenceRetained(
    current.providerEvidence,
    next.providerEvidence,
    "Execution",
  );
  for (const currentLeg of current.legs) {
    const nextLeg = next.legs.find((leg) => leg.legId === currentLeg.legId);
    if (!nextLeg) {
      throw new Error(`Execution leg ${currentLeg.legId} cannot be removed.`);
    }
    if (!LEGAL_LEG_TRANSITIONS[currentLeg.status].has(nextLeg.status)) {
      throw new Error(
        `Illegal execution leg transition ${currentLeg.status} -> ${nextLeg.status}.`,
      );
    }
    if (nextLeg.attemptCount < currentLeg.attemptCount) {
      throw new Error(
        `Execution leg ${currentLeg.legId} attemptCount cannot decrease.`,
      );
    }
    if (
      currentLeg.confirmedHash &&
      nextLeg.confirmedHash !== currentLeg.confirmedHash
    ) {
      throw new Error(
        `Execution leg ${currentLeg.legId} confirmedHash is immutable.`,
      );
    }
    assertEvidenceRetained(
      currentLeg.providerEvidence,
      nextLeg.providerEvidence,
      `Execution leg ${currentLeg.legId}`,
    );
  }
  assertValidExecutionFinalityRecord(next);
  return next;
}

function assertEvidenceRetained(
  current: ExecutionProviderEvidence[],
  next: ExecutionProviderEvidence[],
  label: string,
): void {
  if (next.length < current.length) {
    throw new Error(`${label} provider evidence cannot be removed.`);
  }
  for (let index = 0; index < current.length; index += 1) {
    if (
      JSON.stringify(current[index]) !== JSON.stringify(next[index])
    ) {
      throw new Error(`${label} provider evidence is append-only.`);
    }
  }
}

/** In-memory store for tests and credential-free local development. */
export class MemoryExecutionFinalityStore implements ExecutionFinalityStore {
  private records = new Map<string, ExecutionFinalityRecord>();
  private byAgentIdempotency = new Map<string, string>();
  private byPermit = new Map<string, string>();
  private byQuote = new Map<string, string>();
  private byTransaction = new Map<string, string>();

  constructor(state?: ExecutionFinalityExport) {
    if (state) this.importState(state);
  }

  private idempotencyIdentity(agentId: string, idempotencyKey: string): string {
    return `${agentId}\0${idempotencyKey}`;
  }

  private recordFor(
    index: Map<string, string>,
    key: string,
  ): ExecutionFinalityRecord | null {
    const executionId = index.get(key);
    if (!executionId) return null;
    const record = this.records.get(executionId);
    return record ? cloneExecutionFinalityRecord(record) : null;
  }

  private conflict(
    index: Map<string, string>,
    key: string,
    executionId: string,
    field: ExecutionFinalityConflictError["field"],
  ): void {
    const existing = index.get(key);
    if (existing && existing !== executionId) {
      throw new ExecutionFinalityConflictError(
        field,
        `${field} is already bound to execution ${existing}.`,
      );
    }
  }

  private index(record: ExecutionFinalityRecord): void {
    this.records.set(
      record.executionId,
      cloneExecutionFinalityRecord(record),
    );
    this.byAgentIdempotency.set(
      this.idempotencyIdentity(record.agentId, record.idempotencyKey),
      record.executionId,
    );
    this.byPermit.set(record.permitId, record.executionId);
    this.byQuote.set(record.quoteId, record.executionId);
    if (record.particleTransactionId) {
      this.byTransaction.set(
        record.particleTransactionId,
        record.executionId,
      );
    }
  }

  async create(
    record: ExecutionFinalityRecord,
  ): Promise<ExecutionFinalityRecord> {
    assertValidExecutionFinalityRecord(record);
    const byIdentity = this.recordFor(
      this.byAgentIdempotency,
      this.idempotencyIdentity(record.agentId, record.idempotencyKey),
    );
    if (byIdentity) return resolveIdempotentCreate(byIdentity, record);

    if (this.records.has(record.executionId)) {
      throw new ExecutionFinalityConflictError(
        "executionId",
        `executionId is already bound to execution ${record.executionId}.`,
      );
    }
    this.conflict(this.byPermit, record.permitId, record.executionId, "permitId");
    this.conflict(this.byQuote, record.quoteId, record.executionId, "quoteId");
    if (record.particleTransactionId) {
      this.conflict(
        this.byTransaction,
        record.particleTransactionId,
        record.executionId,
        "particleTransactionId",
      );
    }
    this.index(record);
    return cloneExecutionFinalityRecord(record);
  }

  async get(executionId: string): Promise<ExecutionFinalityRecord | null> {
    const record = this.records.get(executionId);
    return record ? cloneExecutionFinalityRecord(record) : null;
  }

  async getByAgentIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionFinalityRecord | null> {
    return this.recordFor(
      this.byAgentIdempotency,
      this.idempotencyIdentity(agentId, idempotencyKey),
    );
  }

  async getByPermitId(
    permitId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    return this.recordFor(this.byPermit, permitId);
  }

  async getByQuoteId(
    quoteId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    return this.recordFor(this.byQuote, quoteId);
  }

  async getByParticleTransactionId(
    particleTransactionId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    return this.recordFor(this.byTransaction, particleTransactionId);
  }

  async bindParticleTransaction(
    input: BindParticleTransactionInput,
  ): Promise<ExecutionFinalityRecord | null> {
    const transactionId = nonEmpty(
      input.particleTransactionId,
      "particleTransactionId",
    );
    const current = this.records.get(input.executionId);
    if (!current || current.version !== input.expectedVersion) return null;
    if (
      current.particleTransactionId &&
      current.particleTransactionId !== transactionId
    ) {
      throw new ExecutionFinalityConflictError(
        "particleTransactionId",
        "An execution cannot be rebound to another Particle transaction.",
      );
    }
    this.conflict(
      this.byTransaction,
      transactionId,
      input.executionId,
      "particleTransactionId",
    );
    if (current.particleTransactionId === transactionId) {
      return cloneExecutionFinalityRecord(current);
    }
    const next = {
      ...current,
      particleTransactionId: transactionId,
      updatedAt: input.updatedAt,
      version: current.version + 1,
    };
    this.records.set(input.executionId, cloneExecutionFinalityRecord(next));
    this.byTransaction.set(transactionId, input.executionId);
    return cloneExecutionFinalityRecord(next);
  }

  async transition(
    input: TransitionExecutionInput,
  ): Promise<ExecutionFinalityRecord | null> {
    const current = this.records.get(input.executionId);
    if (!current) return null;
    const next = applyExecutionTransition(current, input);
    if (!next) return null;
    this.records.set(input.executionId, cloneExecutionFinalityRecord(next));
    return cloneExecutionFinalityRecord(next);
  }

  exportState(): ExecutionFinalityExport {
    return {
      schemaVersion: 1,
      records: [...this.records.values()].map(cloneExecutionFinalityRecord),
    };
  }

  importState(state: ExecutionFinalityExport): void {
    if (state.schemaVersion !== 1 || !Array.isArray(state.records)) {
      throw new Error("Unsupported execution finality export.");
    }
    const replacement = new MemoryExecutionFinalityStore();
    for (const record of state.records) {
      assertValidExecutionFinalityRecord(record);
      const cloned = cloneExecutionFinalityRecord(record);
      const identity = replacement.idempotencyIdentity(
        cloned.agentId,
        cloned.idempotencyKey,
      );
      replacement.conflict(
        replacement.byAgentIdempotency,
        identity,
        cloned.executionId,
        "agentIdempotency",
      );
      replacement.conflict(
        replacement.byPermit,
        cloned.permitId,
        cloned.executionId,
        "permitId",
      );
      replacement.conflict(
        replacement.byQuote,
        cloned.quoteId,
        cloned.executionId,
        "quoteId",
      );
      if (cloned.particleTransactionId) {
        replacement.conflict(
          replacement.byTransaction,
          cloned.particleTransactionId,
          cloned.executionId,
          "particleTransactionId",
        );
      }
      if (replacement.records.has(cloned.executionId)) {
        throw new ExecutionFinalityConflictError(
          "executionId",
          `Duplicate executionId ${cloned.executionId}.`,
        );
      }
      replacement.index(cloned);
    }
    this.records = replacement.records;
    this.byAgentIdempotency = replacement.byAgentIdempotency;
    this.byPermit = replacement.byPermit;
    this.byQuote = replacement.byQuote;
    this.byTransaction = replacement.byTransaction;
  }

  clear(): void {
    this.records.clear();
    this.byAgentIdempotency.clear();
    this.byPermit.clear();
    this.byQuote.clear();
    this.byTransaction.clear();
  }
}
