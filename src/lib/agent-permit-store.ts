import "server-only";
import { getSql } from "@/lib/db";
import {
  MemoryAgentPermitStore,
  type AgentPermitStore,
  type AgentSpendLedger,
  type ExecutionPermitRecord,
  type ExecutionPermitStatus,
} from "@/lib/agent-permit";
import type { TradeIntent, TradeQuote } from "@/lib/verbs/types";
import {
  MemoryAgentIdempotencyStore,
  MemorySpendLedger,
  type AgentIdempotencyStore,
  type AgentReceiptPersist,
  type AgentExecuteResult,
} from "@/lib/agent-execute";
import { saveReceipt, getStoredReceiptRecord } from "@/lib/receipts";

const memoryPermitStore = new MemoryAgentPermitStore();
const memoryIdempotencyStore = new MemoryAgentIdempotencyStore();
const memorySpendLedger = new MemorySpendLedger();
let neonSchemaReady = false;

type PermitRow = {
  permit_id: string;
  agent_id: string;
  lease_id: string;
  quote_id: string;
  quote_fingerprint: string;
  idempotency_key: string;
  action: string;
  dollars_in: string | number;
  floor_usd: string | number;
  intent: unknown;
  size_usd: string | number;
  agreed_quote: unknown;
  raw_transaction: unknown;
  issued_at: string;
  expires_at: string;
  status: string;
};

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function recordFromRow(row: PermitRow): ExecutionPermitRecord {
  return {
    permitId: row.permit_id,
    agentId: row.agent_id,
    leaseId: row.lease_id,
    quoteId: row.quote_id,
    quoteFingerprint: row.quote_fingerprint,
    idempotencyKey: row.idempotency_key,
    action: "trade",
    dollarsIn: num(row.dollars_in),
    floorUsd: num(row.floor_usd),
    intent: row.intent as TradeIntent,
    sizeUsd: num(row.size_usd),
    agreedQuote: row.agreed_quote as TradeQuote,
    rawTransaction: row.raw_transaction,
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    status: row.status as ExecutionPermitStatus,
  };
}

async function ensurePermitSchema(
  sql: NonNullable<ReturnType<typeof getSql>>,
): Promise<void> {
  if (neonSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_execution_permits (
      permit_id uuid PRIMARY KEY,
      agent_id uuid NOT NULL,
      lease_id text NOT NULL,
      quote_id uuid NOT NULL,
      quote_fingerprint text NOT NULL,
      idempotency_key text NOT NULL,
      action text NOT NULL CHECK (action = 'trade'),
      dollars_in numeric NOT NULL,
      floor_usd numeric NOT NULL,
      intent jsonb NOT NULL,
      size_usd numeric NOT NULL,
      agreed_quote jsonb NOT NULL,
      raw_transaction jsonb NOT NULL,
      issued_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      status text NOT NULL CHECK (
        status IN ('issued', 'consumed', 'released', 'pending')
      )
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_execution_permits_idempotency
      ON agent_execution_permits (agent_id, idempotency_key)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_execute_idempotency (
      agent_id uuid NOT NULL,
      idempotency_key text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (agent_id, idempotency_key)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_spend_reservations (
      agent_id uuid PRIMARY KEY,
      reserved_usd numeric NOT NULL DEFAULT 0
    )
  `;
  neonSchemaReady = true;
}

class NeonAgentPermitStore implements AgentPermitStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async save(record: ExecutionPermitRecord): Promise<void> {
    await ensurePermitSchema(this.sql);
    await this.sql`
      INSERT INTO agent_execution_permits (
        permit_id, agent_id, lease_id, quote_id, quote_fingerprint,
        idempotency_key, action, dollars_in, floor_usd, intent, size_usd,
        agreed_quote, raw_transaction, issued_at, expires_at, status
      ) VALUES (
        ${record.permitId}::uuid,
        ${record.agentId}::uuid,
        ${record.leaseId},
        ${record.quoteId}::uuid,
        ${record.quoteFingerprint},
        ${record.idempotencyKey},
        ${record.action},
        ${record.dollarsIn},
        ${record.floorUsd},
        ${JSON.stringify(record.intent)}::jsonb,
        ${record.sizeUsd},
        ${JSON.stringify(record.agreedQuote)}::jsonb,
        ${JSON.stringify(record.rawTransaction ?? null)}::jsonb,
        ${record.issuedAt}::timestamptz,
        ${record.expiresAt}::timestamptz,
        ${record.status}
      )
    `;
  }

  async get(permitId: string): Promise<ExecutionPermitRecord | null> {
    await ensurePermitSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_execution_permits
      WHERE permit_id = ${permitId}::uuid
      LIMIT 1
    `) as PermitRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<ExecutionPermitRecord | null> {
    await ensurePermitSchema(this.sql);
    const rows = (await this.sql`
      SELECT * FROM agent_execution_permits
      WHERE agent_id = ${agentId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `) as PermitRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }

  async casStatus(
    permitId: string,
    from: ExecutionPermitStatus,
    to: ExecutionPermitStatus,
  ): Promise<boolean> {
    await ensurePermitSchema(this.sql);
    const rows = (await this.sql`
      UPDATE agent_execution_permits
      SET status = ${to}
      WHERE permit_id = ${permitId}::uuid
        AND status = ${from}
      RETURNING permit_id
    `) as Array<{ permit_id: string }>;
    return rows.length > 0;
  }
}

class NeonAgentIdempotencyStore implements AgentIdempotencyStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async get(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentExecuteResult | null> {
    await ensurePermitSchema(this.sql);
    const rows = (await this.sql`
      SELECT result FROM agent_execute_idempotency
      WHERE agent_id = ${agentId}::uuid
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
    `) as Array<{ result: AgentExecuteResult }>;
    return rows[0]?.result ?? null;
  }

  async save(
    agentId: string,
    idempotencyKey: string,
    result: AgentExecuteResult,
  ): Promise<void> {
    await ensurePermitSchema(this.sql);
    await this.sql`
      INSERT INTO agent_execute_idempotency (agent_id, idempotency_key, result)
      VALUES (
        ${agentId}::uuid,
        ${idempotencyKey},
        ${JSON.stringify(result)}::jsonb
      )
      ON CONFLICT (agent_id, idempotency_key) DO NOTHING
    `;
  }
}

/** Durable spend reservations for Neon (ADR 0020). */
export class NeonSpendLedger implements AgentSpendLedger {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async remainingUsd(
    agentId: string,
    spendBudgetUsd: number,
    lifetimeSpendUsd: number,
  ): Promise<number> {
    await ensurePermitSchema(this.sql);
    const rows = (await this.sql`
      SELECT reserved_usd FROM agent_spend_reservations
      WHERE agent_id = ${agentId}::uuid
      LIMIT 1
    `) as Array<{ reserved_usd: string | number }>;
    const reserved = rows[0] ? num(rows[0].reserved_usd) : 0;
    return Math.max(0, spendBudgetUsd - lifetimeSpendUsd - reserved);
  }

  async tryReserve(input: {
    agentId: string;
    dollarsIn: number;
    maxTradeUsd: number;
    spendBudgetUsd: number;
    lifetimeSpendUsd: number;
  }): Promise<boolean> {
    if (input.dollarsIn > input.maxTradeUsd + 1e-9) return false;
    await ensurePermitSchema(this.sql);

    const remaining = await this.remainingUsd(
      input.agentId,
      input.spendBudgetUsd,
      input.lifetimeSpendUsd,
    );
    if (input.dollarsIn > remaining + 1e-9) return false;

    // Upsert with a second remaining check inside the UPDATE WHERE.
    const rows = (await this.sql`
      INSERT INTO agent_spend_reservations (agent_id, reserved_usd)
      VALUES (${input.agentId}::uuid, ${input.dollarsIn})
      ON CONFLICT (agent_id) DO UPDATE
      SET reserved_usd = agent_spend_reservations.reserved_usd + ${input.dollarsIn}
      WHERE (
        ${input.spendBudgetUsd} - ${input.lifetimeSpendUsd}
        - agent_spend_reservations.reserved_usd
      ) + 1e-9 >= ${input.dollarsIn}
      RETURNING agent_id
    `) as Array<{ agent_id: string }>;

    if (rows.length > 0) return true;

    // Concurrent reservation may have won; re-check.
    const after = await this.remainingUsd(
      input.agentId,
      input.spendBudgetUsd,
      input.lifetimeSpendUsd,
    );
    return input.dollarsIn <= after + 1e-9 && rows.length > 0;
  }

  async release(agentId: string, dollarsIn: number): Promise<void> {
    await ensurePermitSchema(this.sql);
    await this.sql`
      UPDATE agent_spend_reservations
      SET reserved_usd = GREATEST(0, reserved_usd - ${dollarsIn})
      WHERE agent_id = ${agentId}::uuid
    `;
  }

  async commit(agentId: string, dollarsIn: number): Promise<void> {
    await this.release(agentId, dollarsIn);
  }
}

/** Neon-authoritative when DATABASE_URL is set; memory fallback for local/mock. */
export function getAgentPermitStore(): AgentPermitStore {
  const sql = getSql();
  if (sql) return new NeonAgentPermitStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent permit storage is not configured.");
  }
  return memoryPermitStore;
}

export function getAgentExecuteIdempotencyStore(): AgentIdempotencyStore {
  const sql = getSql();
  if (sql) return new NeonAgentIdempotencyStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent execute idempotency storage is not configured.");
  }
  return memoryIdempotencyStore;
}

export function getAgentReceiptPersist(): AgentReceiptPersist {
  return new (class implements AgentReceiptPersist {
    async save(receipt: Parameters<AgentReceiptPersist["save"]>[0]) {
      await saveReceipt(receipt);
    }
    async get(receiptId: string) {
      return getStoredReceiptRecord(receiptId);
    }
  })();
}

/** Process-local spend ledger for mock/dev; Neon ledger when DATABASE_URL is set. */
export function getAgentSpendLedger(): AgentSpendLedger {
  const sql = getSql();
  if (sql) return new NeonSpendLedger(sql);
  return memorySpendLedger;
}

/** Test helper — reset in-memory permit/idempotency/spend state. */
export function resetAgentPermitStoresForTests(): void {
  memoryPermitStore.clear();
  memoryIdempotencyStore.clear();
  memorySpendLedger.clear();
}
