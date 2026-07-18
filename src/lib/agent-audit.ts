import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";

/** Permanent append-only agent domain audit events (ADR 0036). */
export const AGENT_AUDIT_EVENT_TYPES = [
  "policy_updated",
  "budget_changed",
  "action_toggled",
  "disabled",
  "enabled",
  "capped",
  "cap_lifted",
] as const;

export type AgentAuditEventType = (typeof AGENT_AUDIT_EVENT_TYPES)[number];

export type AgentAuditActor = "operator" | "system";

export type AgentAuditEvent = {
  eventId: string;
  agentId: string;
  ownerUserId: string;
  type: AgentAuditEventType;
  actor: AgentAuditActor;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AgentAuditStore = {
  append(event: AgentAuditEvent): Promise<void>;
  listByAgent(agentId: string, limit?: number): Promise<AgentAuditEvent[]>;
};

function isAuditEventType(value: string): value is AgentAuditEventType {
  return (AGENT_AUDIT_EVENT_TYPES as readonly string[]).includes(value);
}

export function auditEventFromRow(row: Record<string, unknown>): AgentAuditEvent {
  const type = String(row.type ?? "");
  if (!isAuditEventType(type)) {
    throw new Error(`Unexpected agent audit event type: ${type}`);
  }
  const actor = String(row.actor ?? "");
  if (actor !== "operator" && actor !== "system") {
    throw new Error(`Unexpected agent audit actor: ${actor}`);
  }
  const detailsRaw = row.details;
  const details =
    typeof detailsRaw === "object" && detailsRaw !== null
      ? (detailsRaw as Record<string, unknown>)
      : {};

  return {
    eventId: String(row.event_id),
    agentId: String(row.agent_id),
    ownerUserId: String(row.owner_user_id),
    type,
    actor,
    details,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export function buildAuditEvent(input: {
  agentId: string;
  ownerUserId: string;
  type: AgentAuditEventType;
  actor: AgentAuditActor;
  details?: Record<string, unknown>;
  now?: Date;
  eventId?: string;
}): AgentAuditEvent {
  return {
    eventId: input.eventId ?? randomUUID(),
    agentId: input.agentId,
    ownerUserId: input.ownerUserId,
    type: input.type,
    actor: input.actor,
    details: input.details ?? {},
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export class MemoryAgentAuditStore implements AgentAuditStore {
  readonly events: AgentAuditEvent[] = [];

  async append(event: AgentAuditEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async listByAgent(
    agentId: string,
    limit = 100,
  ): Promise<AgentAuditEvent[]> {
    return this.events
      .filter((event) => event.agentId === agentId)
      .slice(-limit)
      .map((event) => structuredClone(event));
  }

  clear(): void {
    this.events.length = 0;
  }
}

let neonAuditSchemaReady = false;
const memoryAuditStore = new MemoryAgentAuditStore();

class NeonAgentAuditStore implements AgentAuditStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  private async ensureSchema(): Promise<void> {
    if (neonAuditSchemaReady) return;
    await this.sql`
      CREATE TABLE IF NOT EXISTS agent_audit_events (
        event_id uuid PRIMARY KEY,
        agent_id uuid NOT NULL,
        owner_user_id text NOT NULL,
        type text NOT NULL,
        actor text NOT NULL CHECK (actor IN ('operator', 'system')),
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS agent_audit_events_agent_created
        ON agent_audit_events (agent_id, created_at DESC)
    `;
    neonAuditSchemaReady = true;
  }

  async append(event: AgentAuditEvent): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO agent_audit_events (
        event_id, agent_id, owner_user_id, type, actor, details, created_at
      ) VALUES (
        ${event.eventId}::uuid,
        ${event.agentId}::uuid,
        ${event.ownerUserId},
        ${event.type},
        ${event.actor},
        ${JSON.stringify(event.details)}::jsonb,
        ${event.createdAt}::timestamptz
      )
    `;
  }

  async listByAgent(
    agentId: string,
    limit = 100,
  ): Promise<AgentAuditEvent[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT * FROM agent_audit_events
      WHERE agent_id = ${agentId}::uuid
      ORDER BY created_at DESC
      LIMIT ${Math.max(1, Math.min(limit, 500))}
    `;
    return (rows as Array<Record<string, unknown>>)
      .map(auditEventFromRow)
      .reverse();
  }
}

/** Neon when DATABASE_URL is set; memory for local/mock. */
export function getAgentAuditStore(): AgentAuditStore {
  const sql = getSql();
  if (sql) return new NeonAgentAuditStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent audit storage is not configured.");
  }
  return memoryAuditStore;
}

/** Test helper — reset in-memory audit events. */
export function resetAgentAuditStoreForTests(): void {
  memoryAuditStore.clear();
}
