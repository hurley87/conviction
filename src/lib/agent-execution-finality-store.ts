import "server-only";

import { getSql } from "@/lib/db";
import {
  applyExecutionTransition,
  assertValidExecutionFinalityRecord,
  ExecutionFinalityConflictError,
  MemoryExecutionFinalityStore,
  resolveIdempotentCreate,
  type BindParticleTransactionInput,
  type ExecutionFinalityRecord,
  type ExecutionFinalityStore,
  type ExecutionLeg,
  type ExecutionOutcome,
  type ExecutionProviderEvidence,
  type OperatorRecoveryGuidance,
  type TransitionExecutionInput,
} from "@/lib/agent-execution-finality";

type Sql = NonNullable<ReturnType<typeof getSql>>;

const memoryStore = new MemoryExecutionFinalityStore();
let neonSchemaReady = false;

type ExecutionRow = {
  execution_id: string;
  agent_id: string;
  permit_id: string;
  quote_id: string;
  idempotency_key: string;
  particle_transaction_id: string | null;
  outcome: string;
  legs: unknown;
  provider_evidence: unknown;
  attempt_count: number | null;
  last_provider_status: string | null;
  last_error: string | null;
  workflow_correlation_id: string | null;
  workflow_run_id: string | null;
  operator_recovery: unknown;
  settlement_status: string | null;
  settlement_result: unknown;
  settlement_error: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  finalized_at: string | null;
  version: number;
};

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function recordFromRow(row: ExecutionRow): ExecutionFinalityRecord {
  const record: ExecutionFinalityRecord = {
    executionId: row.execution_id,
    agentId: row.agent_id,
    permitId: row.permit_id,
    quoteId: row.quote_id,
    idempotencyKey: row.idempotency_key,
    particleTransactionId: row.particle_transaction_id,
    outcome: row.outcome as ExecutionOutcome,
    legs: arrayOf<ExecutionLeg>(row.legs),
    providerEvidence: arrayOf<ExecutionProviderEvidence>(
      row.provider_evidence,
    ),
    attemptCount: row.attempt_count ?? 0,
    lastProviderStatus: row.last_provider_status,
    lastError: row.last_error,
    workflowCorrelationId: row.workflow_correlation_id,
    workflowRunId: row.workflow_run_id,
    operatorRecovery:
      row.operator_recovery && typeof row.operator_recovery === "object"
        ? (row.operator_recovery as OperatorRecoveryGuidance)
        : null,
    settlementStatus:
      (row.settlement_status as ExecutionFinalityRecord["settlementStatus"] | null) ??
      "held",
    settlementResult:
      row.settlement_result && typeof row.settlement_result === "object"
        ? (row.settlement_result as ExecutionFinalityRecord["settlementResult"])
        : null,
    settlementError: row.settlement_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    submittedAt: row.submitted_at
      ? new Date(row.submitted_at).toISOString()
      : null,
    finalizedAt: row.finalized_at
      ? new Date(row.finalized_at).toISOString()
      : null,
    version: row.version,
  };
  assertValidExecutionFinalityRecord(record);
  return record;
}

async function ensureSchema(sql: Sql): Promise<void> {
  if (neonSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_execution_finality (
      execution_id uuid PRIMARY KEY,
      agent_id uuid NOT NULL,
      permit_id uuid NOT NULL UNIQUE,
      quote_id uuid NOT NULL UNIQUE,
      idempotency_key text NOT NULL,
      particle_transaction_id text UNIQUE,
      outcome text NOT NULL CHECK (
        outcome IN (
          'submitted', 'pending', 'finalized', 'partial', 'failed',
          'needs_attention'
        )
      ),
      legs jsonb NOT NULL DEFAULT '[]'::jsonb,
      provider_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
      attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_provider_status text,
      last_error text,
      workflow_correlation_id text,
      workflow_run_id text,
      operator_recovery jsonb,
      settlement_status text NOT NULL DEFAULT 'held' CHECK (
        settlement_status IN (
          'held', 'accounting', 'persisting', 'settled', 'released',
          'needs_attention'
        )
      ),
      settlement_result jsonb,
      settlement_error text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      submitted_at timestamptz,
      finalized_at timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      UNIQUE (agent_id, idempotency_key)
    )
  `;
  await sql`
    ALTER TABLE agent_execution_finality
      ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'held',
      ADD COLUMN IF NOT EXISTS settlement_result jsonb,
      ADD COLUMN IF NOT EXISTS settlement_error text
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS agent_execution_finality_outcome
      ON agent_execution_finality (outcome, updated_at)
  `;
  neonSchemaReady = true;
}

/** Neon implementation with the same unique identities and versioned CAS API. */
export class NeonExecutionFinalityStore implements ExecutionFinalityStore {
  constructor(private readonly sql: Sql) {}

  private async one(
    query: Promise<unknown>,
  ): Promise<ExecutionFinalityRecord | null> {
    const row = (await query as ExecutionRow[])[0];
    return row ? recordFromRow(row) : null;
  }

  async create(
    record: ExecutionFinalityRecord,
  ): Promise<ExecutionFinalityRecord> {
    assertValidExecutionFinalityRecord(record);
    await ensureSchema(this.sql);
    try {
      const rows = (await this.sql`
        INSERT INTO agent_execution_finality (
          execution_id, agent_id, permit_id, quote_id, idempotency_key,
          particle_transaction_id, outcome, legs, provider_evidence,
          attempt_count, last_provider_status, last_error,
          workflow_correlation_id, workflow_run_id, operator_recovery,
          settlement_status, settlement_result, settlement_error,
          created_at, updated_at, submitted_at, finalized_at, version
        ) VALUES (
          ${record.executionId}::uuid,
          ${record.agentId}::uuid,
          ${record.permitId}::uuid,
          ${record.quoteId}::uuid,
          ${record.idempotencyKey},
          ${record.particleTransactionId},
          ${record.outcome},
          ${JSON.stringify(record.legs)}::jsonb,
          ${JSON.stringify(record.providerEvidence)}::jsonb,
          ${record.attemptCount},
          ${record.lastProviderStatus},
          ${record.lastError},
          ${record.workflowCorrelationId},
          ${record.workflowRunId},
          ${record.operatorRecovery ? JSON.stringify(record.operatorRecovery) : null}::jsonb,
          ${record.settlementStatus},
          ${record.settlementResult ? JSON.stringify(record.settlementResult) : null}::jsonb,
          ${record.settlementError},
          ${record.createdAt}::timestamptz,
          ${record.updatedAt}::timestamptz,
          ${record.submittedAt}::timestamptz,
          ${record.finalizedAt}::timestamptz,
          ${record.version}
        )
        ON CONFLICT (agent_id, idempotency_key) DO NOTHING
        RETURNING *
      `) as ExecutionRow[];
      if (rows[0]) return recordFromRow(rows[0]);
    } catch {
      // Resolve the exact unique identity below and return a stable error.
    }

    const byIdentity = await this.getByAgentIdempotency(
      record.agentId,
      record.idempotencyKey,
    );
    if (byIdentity) return resolveIdempotentCreate(byIdentity, record);
    if (await this.get(record.executionId)) {
      throw new ExecutionFinalityConflictError(
        "executionId",
        `executionId is already bound to execution ${record.executionId}.`,
      );
    }
    if (await this.getByPermitId(record.permitId)) {
      throw new ExecutionFinalityConflictError(
        "permitId",
        "permitId is already bound to another execution.",
      );
    }
    if (await this.getByQuoteId(record.quoteId)) {
      throw new ExecutionFinalityConflictError(
        "quoteId",
        "quoteId is already bound to another execution.",
      );
    }
    if (
      record.particleTransactionId &&
      (await this.getByParticleTransactionId(record.particleTransactionId))
    ) {
      throw new ExecutionFinalityConflictError(
        "particleTransactionId",
        "particleTransactionId is already bound to another execution.",
      );
    }
    throw new Error(`Failed to persist execution ${record.executionId}.`);
  }

  async get(executionId: string): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    return this.one(this.sql`
      SELECT * FROM agent_execution_finality
      WHERE execution_id = ${executionId}::uuid
      LIMIT 1
    `);
  }

  async listByAgentId(
    agentId: string,
    limit = 100,
  ): Promise<ExecutionFinalityRecord[]> {
    await ensureSchema(this.sql);
    const bounded = Math.max(1, Math.min(limit, 500));
    const rows = (await this.sql`
      SELECT * FROM agent_execution_finality
      WHERE agent_id = ${agentId}::uuid
      ORDER BY updated_at DESC
      LIMIT ${bounded}
    `) as ExecutionRow[];
    return rows.map(recordFromRow);
  }

  async getByAgentIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    return this.one(this.sql`
      SELECT * FROM agent_execution_finality
      WHERE agent_id = ${agentId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `);
  }

  async getByPermitId(
    permitId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    return this.one(this.sql`
      SELECT * FROM agent_execution_finality
      WHERE permit_id = ${permitId}::uuid
      LIMIT 1
    `);
  }

  async getByQuoteId(
    quoteId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    return this.one(this.sql`
      SELECT * FROM agent_execution_finality
      WHERE quote_id = ${quoteId}::uuid
      LIMIT 1
    `);
  }

  async getByParticleTransactionId(
    particleTransactionId: string,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    return this.one(this.sql`
      SELECT * FROM agent_execution_finality
      WHERE particle_transaction_id = ${particleTransactionId}
      LIMIT 1
    `);
  }

  async bindParticleTransaction(
    input: BindParticleTransactionInput,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    const transactionId = input.particleTransactionId.trim();
    if (!transactionId) throw new Error("particleTransactionId must not be empty.");
    const current = await this.get(input.executionId);
    if (!current || current.version !== input.expectedVersion) return null;
    if (current.particleTransactionId === transactionId) {
      return current;
    }
    if (current.particleTransactionId) {
      throw new ExecutionFinalityConflictError(
        "particleTransactionId",
        "An execution cannot be rebound to another Particle transaction.",
      );
    }
    try {
      const rows = (await this.sql`
        UPDATE agent_execution_finality
        SET
          particle_transaction_id = ${transactionId},
          updated_at = ${input.updatedAt}::timestamptz,
          version = version + 1
        WHERE execution_id = ${input.executionId}::uuid
          AND version = ${input.expectedVersion}
          AND particle_transaction_id IS NULL
        RETURNING *
      `) as ExecutionRow[];
      return rows[0] ? recordFromRow(rows[0]) : null;
    } catch {
      const owner = await this.getByParticleTransactionId(transactionId);
      if (owner && owner.executionId !== input.executionId) {
        throw new ExecutionFinalityConflictError(
          "particleTransactionId",
          `Particle transaction is already bound to execution ${owner.executionId}.`,
        );
      }
      throw new Error(
        `Failed to bind Particle transaction to ${input.executionId}.`,
      );
    }
  }

  async transition(
    input: TransitionExecutionInput,
  ): Promise<ExecutionFinalityRecord | null> {
    await ensureSchema(this.sql);
    const current = await this.get(input.executionId);
    if (!current) return null;
    const next = applyExecutionTransition(current, input);
    if (!next) return null;
    const rows = (await this.sql`
      UPDATE agent_execution_finality
      SET
        outcome = ${next.outcome},
        legs = ${JSON.stringify(next.legs)}::jsonb,
        provider_evidence = ${JSON.stringify(next.providerEvidence)}::jsonb,
        attempt_count = ${next.attemptCount},
        last_provider_status = ${next.lastProviderStatus},
        last_error = ${next.lastError},
        workflow_correlation_id = ${next.workflowCorrelationId},
        workflow_run_id = ${next.workflowRunId},
        operator_recovery = ${next.operatorRecovery ? JSON.stringify(next.operatorRecovery) : null}::jsonb,
        settlement_status = ${next.settlementStatus},
        settlement_result = ${next.settlementResult ? JSON.stringify(next.settlementResult) : null}::jsonb,
        settlement_error = ${next.settlementError},
        updated_at = ${next.updatedAt}::timestamptz,
        submitted_at = ${next.submittedAt}::timestamptz,
        finalized_at = ${next.finalizedAt}::timestamptz,
        version = ${next.version}
      WHERE execution_id = ${input.executionId}::uuid
        AND version = ${input.expectedVersion}
        AND outcome = ${input.from}
      RETURNING *
    `) as ExecutionRow[];
    return rows[0] ? recordFromRow(rows[0]) : null;
  }
}

/** Neon-authoritative when DATABASE_URL is set; memory fallback otherwise. */
export function getExecutionFinalityStore(): ExecutionFinalityStore {
  const sql = getSql();
  if (sql) return new NeonExecutionFinalityStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Execution finality storage is not configured.");
  }
  return memoryStore;
}

export function getMemoryExecutionFinalityStoreForTests(): MemoryExecutionFinalityStore {
  return memoryStore;
}

export function resetExecutionFinalityStoreForTests(): void {
  memoryStore.clear();
  neonSchemaReady = false;
}
