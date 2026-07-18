import "server-only";
import { getSql } from "@/lib/db";
import {
  MemoryAgentBackRecordStore,
  type AgentBackRecord,
  type AgentBackRecordStore,
  type ReconciliationState,
} from "@/lib/agent-back";

const memoryStore = new MemoryAgentBackRecordStore();
let neonSchemaReady = false;

type BackRow = {
  back_record_id: string;
  agent_id: string;
  entry_id: string;
  receipt_id: string;
  quote_id: string;
  quote_fingerprint: string;
  idempotency_key: string;
  authorship: AgentBackRecord["authorship"];
  reconciliation_state: string;
  attempt_count: number | null;
  workflow_run_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function recordFromRow(row: BackRow): AgentBackRecord {
  return {
    backRecordId: row.back_record_id,
    agentId: row.agent_id,
    entryId: row.entry_id,
    receiptId: row.receipt_id,
    quoteId: row.quote_id,
    quoteFingerprint: row.quote_fingerprint,
    idempotencyKey: row.idempotency_key,
    authorship: row.authorship,
    reconciliationState: row.reconciliation_state as ReconciliationState,
    attemptCount: row.attempt_count ?? 0,
    workflowRunId: row.workflow_run_id,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

async function ensureSchema(
  sql: NonNullable<ReturnType<typeof getSql>>,
): Promise<void> {
  if (neonSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_backs (
      back_record_id uuid PRIMARY KEY,
      agent_id uuid NOT NULL,
      entry_id text NOT NULL,
      receipt_id text NOT NULL UNIQUE,
      quote_id uuid NOT NULL,
      quote_fingerprint text NOT NULL,
      idempotency_key text NOT NULL,
      authorship jsonb NOT NULL,
      reconciliation_state text NOT NULL CHECK (
        reconciliation_state IN ('complete', 'pending_sync', 'needs_attention')
      ),
      attempt_count integer NOT NULL DEFAULT 0,
      workflow_run_id text,
      last_error text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      UNIQUE (agent_id, idempotency_key)
    )
  `;
  await sql`
    ALTER TABLE agent_backs
      ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS agent_backs_entry_id
      ON agent_backs (entry_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS agent_backs_reconciliation
      ON agent_backs (reconciliation_state)
  `;
  neonSchemaReady = true;
}

class NeonAgentBackRecordStore implements AgentBackRecordStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async save(record: AgentBackRecord): Promise<AgentBackRecord> {
    await ensureSchema(this.sql);
    try {
      await this.sql`
        INSERT INTO agent_backs (
          back_record_id, agent_id, entry_id, receipt_id, quote_id,
          quote_fingerprint, idempotency_key, authorship, reconciliation_state,
          attempt_count, workflow_run_id, last_error, created_at, updated_at,
          completed_at
        ) VALUES (
          ${record.backRecordId}::uuid,
          ${record.agentId}::uuid,
          ${record.entryId},
          ${record.receiptId},
          ${record.quoteId}::uuid,
          ${record.quoteFingerprint},
          ${record.idempotencyKey},
          ${JSON.stringify(record.authorship)}::jsonb,
          ${record.reconciliationState},
          ${record.attemptCount},
          ${record.workflowRunId},
          ${record.lastError},
          ${record.createdAt}::timestamptz,
          ${record.updatedAt}::timestamptz,
          ${record.completedAt}::timestamptz
        )
        ON CONFLICT (receipt_id) DO NOTHING
      `;
    } catch {
      // Unique (agent_id, idempotency_key) or other conflict — resolve below.
    }

    const byReceipt = await this.getByReceiptId(record.receiptId);
    if (byReceipt) return byReceipt;

    const byIdem = await this.getByIdempotency(
      record.agentId,
      record.idempotencyKey,
    );
    if (byIdem) return byIdem;

    throw new Error(
      `Failed to persist back record for receipt ${record.receiptId}.`,
    );
  }

  async get(backRecordId: string): Promise<AgentBackRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_backs
      WHERE back_record_id = ${backRecordId}::uuid
      LIMIT 1
    `) as BackRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async getByReceiptId(receiptId: string): Promise<AgentBackRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_backs
      WHERE receipt_id = ${receiptId}
      LIMIT 1
    `) as BackRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentBackRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_backs
      WHERE agent_id = ${agentId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `) as BackRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async casReconciliationState(input: {
    backRecordId: string;
    from: ReconciliationState;
    to: ReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentBackRecord | null> {
    await ensureSchema(this.sql);
    const current = await this.get(input.backRecordId);
    if (!current || current.reconciliationState !== input.from) return null;

    const next: AgentBackRecord = {
      ...current,
      reconciliationState: input.to,
      updatedAt: new Date().toISOString(),
      ...(input.workflowRunId !== undefined
        ? { workflowRunId: input.workflowRunId }
        : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.completedAt !== undefined
        ? { completedAt: input.completedAt }
        : {}),
      ...(input.attemptCount !== undefined
        ? { attemptCount: input.attemptCount }
        : {}),
    };

    const rows = (await this.sql`
      UPDATE agent_backs
      SET
        reconciliation_state = ${next.reconciliationState},
        attempt_count = ${next.attemptCount},
        updated_at = ${next.updatedAt}::timestamptz,
        workflow_run_id = ${next.workflowRunId},
        last_error = ${next.lastError},
        completed_at = ${next.completedAt}::timestamptz
      WHERE back_record_id = ${input.backRecordId}::uuid
        AND reconciliation_state = ${input.from}
      RETURNING *
    `) as BackRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async setWorkflowRunId(
    backRecordId: string,
    workflowRunId: string,
  ): Promise<void> {
    await ensureSchema(this.sql);
    const updatedAt = new Date().toISOString();
    await this.sql`
      UPDATE agent_backs
      SET workflow_run_id = ${workflowRunId},
          updated_at = ${updatedAt}::timestamptz
      WHERE back_record_id = ${backRecordId}::uuid
    `;
  }
}

/** Neon-authoritative when DATABASE_URL is set; memory fallback for local/mock. */
export function getAgentBackRecordStore(): AgentBackRecordStore {
  const sql = getSql();
  if (sql) return new NeonAgentBackRecordStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent back-record storage is not configured.");
  }
  return memoryStore;
}

/** Test helper — reset the in-memory back-record store between cases. */
export function resetMemoryAgentBackRecordStoreForTests(): void {
  memoryStore.clear();
}
