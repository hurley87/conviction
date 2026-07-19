import "server-only";
import { getSql } from "@/lib/db";
import {
  MemoryAgentRetirementStore,
  RECOVERY_CLAIM_TTL_MS,
  type AgentRetirementRecord,
  type AgentRetirementStore,
  type RetirementConversionLeg,
  type RetirementReconciliationState,
  type RetirementResidualHolding,
  type RetirementTransferLeg,
} from "@/lib/agent-retirement";

const memoryStore = new MemoryAgentRetirementStore();
let neonSchemaReady = false;

type RetirementRow = {
  retirement_id: string;
  agent_id: string;
  owner_user_id: string;
  return_address: string;
  idempotency_key: string;
  reconciliation_state: string;
  conversion_legs: unknown;
  transfer_leg: unknown;
  residual_holdings: unknown;
  residual_observation: unknown;
  recovered_usd: number | string;
  dust_usd: number | string;
  attempt_count: number | null;
  workflow_run_id: string | null;
  last_error: string | null;
  recovery_claim_token: string | null;
  recovery_claimed_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function residualObservationFromUnknown(
  value: unknown,
): AgentRetirementRecord["residualObservation"] {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    consecutiveDustObservations:
      typeof source.consecutiveDustObservations === "number" &&
      Number.isInteger(source.consecutiveDustObservations) &&
      source.consecutiveDustObservations >= 0
        ? source.consecutiveDustObservations
        : 0,
    firstDustObservedAt:
      typeof source.firstDustObservedAt === "string"
        ? source.firstDustObservedAt
        : null,
    lastObservedAt:
      typeof source.lastObservedAt === "string"
        ? source.lastObservedAt
        : null,
    lastResidualUsd:
      typeof source.lastResidualUsd === "number"
        ? source.lastResidualUsd
        : null,
  };
}

function legFinalityFromUnknown(
  value: unknown,
): RetirementConversionLeg["finality"] {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    outcome:
      typeof source.outcome === "string"
        ? (source.outcome as RetirementConversionLeg["finality"]["outcome"])
        : null,
    providerStatus:
      typeof source.providerStatus === "string"
        ? source.providerStatus
        : null,
    attemptCount:
      typeof source.attemptCount === "number" &&
      Number.isInteger(source.attemptCount) &&
      source.attemptCount >= 0
        ? source.attemptCount
        : 0,
    submittedAt:
      typeof source.submittedAt === "string" ? source.submittedAt : null,
    confirmedAt:
      typeof source.confirmedAt === "string" ? source.confirmedAt : null,
    confirmedHashes: Array.isArray(source.confirmedHashes)
      ? (source.confirmedHashes as RetirementConversionLeg["finality"]["confirmedHashes"])
      : [],
    providerEvidence: Array.isArray(source.providerEvidence)
      ? (source.providerEvidence as RetirementConversionLeg["finality"]["providerEvidence"])
      : [],
  };
}

function conversionLegsFromUnknown(value: unknown): RetirementConversionLeg[] {
  return asArray<RetirementConversionLeg>(value).map((leg) => ({
    ...leg,
    finality: legFinalityFromUnknown(leg.finality),
  }));
}

function transferLegFromUnknown(value: unknown): RetirementTransferLeg | null {
  if (!value || typeof value !== "object") return null;
  const leg = value as RetirementTransferLeg;
  return { ...leg, finality: legFinalityFromUnknown(leg.finality) };
}

function recordFromRow(row: RetirementRow): AgentRetirementRecord {
  return {
    retirementId: row.retirement_id,
    agentId: row.agent_id,
    ownerUserId: row.owner_user_id,
    returnAddress: row.return_address,
    idempotencyKey: row.idempotency_key,
    reconciliationState:
      row.reconciliation_state as RetirementReconciliationState,
    conversionLegs: conversionLegsFromUnknown(row.conversion_legs),
    transferLeg: transferLegFromUnknown(row.transfer_leg),
    residualHoldings: asArray<RetirementResidualHolding>(
      row.residual_holdings,
    ),
    residualObservation: residualObservationFromUnknown(
      row.residual_observation,
    ),
    recoveredUsd: Number(row.recovered_usd),
    dustUsd: Number(row.dust_usd),
    attemptCount: row.attempt_count ?? 0,
    workflowRunId: row.workflow_run_id,
    lastError: row.last_error,
    recoveryClaimToken: row.recovery_claim_token ?? null,
    recoveryClaimedAt: row.recovery_claimed_at
      ? new Date(row.recovery_claimed_at).toISOString()
      : null,
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
    CREATE TABLE IF NOT EXISTS agent_retirements (
      retirement_id uuid PRIMARY KEY,
      agent_id uuid NOT NULL UNIQUE,
      owner_user_id text NOT NULL,
      return_address text NOT NULL,
      idempotency_key text NOT NULL,
      reconciliation_state text NOT NULL CHECK (
        reconciliation_state IN ('complete', 'pending_sync', 'needs_attention')
      ),
      conversion_legs jsonb NOT NULL DEFAULT '[]'::jsonb,
      transfer_leg jsonb,
      residual_holdings jsonb NOT NULL DEFAULT '[]'::jsonb,
      residual_observation jsonb NOT NULL DEFAULT '{}'::jsonb,
      recovered_usd numeric NOT NULL DEFAULT 0,
      dust_usd numeric NOT NULL DEFAULT 0,
      attempt_count integer NOT NULL DEFAULT 0,
      workflow_run_id text,
      last_error text,
      recovery_claim_token text,
      recovery_claimed_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      UNIQUE (agent_id, idempotency_key)
    )
  `;
  await sql`
    ALTER TABLE agent_retirements
      ADD COLUMN IF NOT EXISTS recovery_claim_token text
  `;
  await sql`
    ALTER TABLE agent_retirements
      ADD COLUMN IF NOT EXISTS recovery_claimed_at timestamptz
  `;
  await sql`
    ALTER TABLE agent_retirements
      ADD COLUMN IF NOT EXISTS residual_observation jsonb NOT NULL DEFAULT '{}'::jsonb
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS agent_retirements_reconciliation
      ON agent_retirements (reconciliation_state)
  `;
  neonSchemaReady = true;
}

class NeonAgentRetirementStore implements AgentRetirementStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async save(record: AgentRetirementRecord): Promise<AgentRetirementRecord> {
    await ensureSchema(this.sql);
    try {
      await this.sql`
        INSERT INTO agent_retirements (
          retirement_id, agent_id, owner_user_id, return_address,
          idempotency_key, reconciliation_state, conversion_legs, transfer_leg,
          residual_holdings, residual_observation, recovered_usd, dust_usd, attempt_count,
          workflow_run_id, last_error, recovery_claim_token, recovery_claimed_at,
          created_at, updated_at, completed_at
        ) VALUES (
          ${record.retirementId}::uuid,
          ${record.agentId}::uuid,
          ${record.ownerUserId},
          ${record.returnAddress},
          ${record.idempotencyKey},
          ${record.reconciliationState},
          ${JSON.stringify(record.conversionLegs)}::jsonb,
          ${record.transferLeg ? JSON.stringify(record.transferLeg) : null}::jsonb,
          ${JSON.stringify(record.residualHoldings)}::jsonb,
          ${JSON.stringify(record.residualObservation)}::jsonb,
          ${record.recoveredUsd},
          ${record.dustUsd},
          ${record.attemptCount},
          ${record.workflowRunId},
          ${record.lastError},
          ${record.recoveryClaimToken},
          ${record.recoveryClaimedAt}::timestamptz,
          ${record.createdAt}::timestamptz,
          ${record.updatedAt}::timestamptz,
          ${record.completedAt}::timestamptz
        )
        ON CONFLICT (agent_id) DO NOTHING
      `;
    } catch {
      // Resolve via agent_id / idempotency below.
    }

    const byAgent = await this.getByAgentId(record.agentId);
    if (byAgent) return byAgent;

    const byIdem = await this.getByIdempotency(
      record.agentId,
      record.idempotencyKey,
    );
    if (byIdem) return byIdem;

    throw new Error(
      `Failed to persist retirement record for agent ${record.agentId}.`,
    );
  }

  async get(retirementId: string): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_retirements
      WHERE retirement_id = ${retirementId}::uuid
      LIMIT 1
    `) as RetirementRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async getByAgentId(agentId: string): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_retirements
      WHERE agent_id = ${agentId}::uuid
      LIMIT 1
    `) as RetirementRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_retirements
      WHERE agent_id = ${agentId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `) as RetirementRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async update(record: AgentRetirementRecord): Promise<AgentRetirementRecord> {
    await ensureSchema(this.sql);
    const rows = (await this.sql`
      UPDATE agent_retirements
      SET
        reconciliation_state = ${record.reconciliationState},
        conversion_legs = ${JSON.stringify(record.conversionLegs)}::jsonb,
        transfer_leg = ${record.transferLeg ? JSON.stringify(record.transferLeg) : null}::jsonb,
        residual_holdings = ${JSON.stringify(record.residualHoldings)}::jsonb,
        residual_observation = ${JSON.stringify(record.residualObservation)}::jsonb,
        recovered_usd = ${record.recoveredUsd},
        dust_usd = ${record.dustUsd},
        attempt_count = ${record.attemptCount},
        workflow_run_id = ${record.workflowRunId},
        last_error = ${record.lastError},
        recovery_claim_token = ${record.recoveryClaimToken},
        recovery_claimed_at = ${record.recoveryClaimedAt}::timestamptz,
        updated_at = ${record.updatedAt}::timestamptz,
        completed_at = ${record.completedAt}::timestamptz
      WHERE retirement_id = ${record.retirementId}::uuid
      RETURNING *
    `) as RetirementRow[];
    const row = rows[0];
    if (!row) {
      throw new Error(`Unknown retirement ${record.retirementId}`);
    }
    return recordFromRow(row);
  }

  async casReconciliationState(input: {
    retirementId: string;
    from: RetirementReconciliationState;
    to: RetirementReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const current = await this.get(input.retirementId);
    if (!current || current.reconciliationState !== input.from) return null;

    const next: AgentRetirementRecord = {
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
    return this.update(next);
  }

  async setWorkflowRunId(
    retirementId: string,
    workflowRunId: string,
  ): Promise<void> {
    await ensureSchema(this.sql);
    const updatedAt = new Date().toISOString();
    await this.sql`
      UPDATE agent_retirements
      SET workflow_run_id = ${workflowRunId},
          updated_at = ${updatedAt}::timestamptz
      WHERE retirement_id = ${retirementId}::uuid
    `;
  }

  async claimRecovery(input: {
    retirementId: string;
    claimToken: string;
    now: Date;
    ttlMs?: number;
  }): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const ttl = input.ttlMs ?? RECOVERY_CLAIM_TTL_MS;
    const expiresBefore = new Date(input.now.getTime() - ttl).toISOString();
    const claimedAt = input.now.toISOString();
    const rows = (await this.sql`
      UPDATE agent_retirements
      SET
        recovery_claim_token = ${input.claimToken},
        recovery_claimed_at = ${claimedAt}::timestamptz,
        updated_at = ${claimedAt}::timestamptz
      WHERE retirement_id = ${input.retirementId}::uuid
        AND (
          recovery_claim_token IS NULL
          OR recovery_claim_token = ${input.claimToken}
          OR recovery_claimed_at IS NULL
          OR recovery_claimed_at <= ${expiresBefore}::timestamptz
        )
      RETURNING *
    `) as RetirementRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async releaseRecovery(input: {
    retirementId: string;
    claimToken: string;
  }): Promise<AgentRetirementRecord | null> {
    await ensureSchema(this.sql);
    const updatedAt = new Date().toISOString();
    const rows = (await this.sql`
      UPDATE agent_retirements
      SET
        recovery_claim_token = NULL,
        recovery_claimed_at = NULL,
        updated_at = ${updatedAt}::timestamptz
      WHERE retirement_id = ${input.retirementId}::uuid
        AND recovery_claim_token = ${input.claimToken}
      RETURNING *
    `) as RetirementRow[];
    const row = rows[0];
    if (row) return recordFromRow(row);
    return this.get(input.retirementId);
  }
}

/** Neon-authoritative when DATABASE_URL is set; memory fallback for local/mock. */
export function getAgentRetirementStore(): AgentRetirementStore {
  const sql = getSql();
  if (sql) return new NeonAgentRetirementStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent retirement storage is not configured.");
  }
  return memoryStore;
}

export function getMemoryAgentRetirementStoreForTests(): MemoryAgentRetirementStore {
  return memoryStore;
}
