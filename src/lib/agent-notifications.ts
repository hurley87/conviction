import { randomUUID } from "node:crypto";

import { getSql } from "@/lib/db";

export type NotificationKind =
  | "trade_success"
  | "back_success"
  | "reconciliation_needs_attention"
  | "lifecycle"
  | "policy";
export type Severity = "info" | "warning" | "critical";

export type AgentNotification = {
  notificationId: string;
  agentId: string;
  ownerUserId: string;
  kind: NotificationKind;
  severity: Severity;
  title: string;
  body: string;
  dedupeKey: string;
  receiptId?: string;
  backRecordId?: string;
  retirementId?: string;
  correlationId?: string;
  readAt: string | null;
  createdAt: string;
};

export type CreateAgentNotification = Omit<
  AgentNotification,
  "notificationId" | "readAt" | "createdAt"
> & {
  notificationId?: string;
  readAt?: string | null;
  createdAt?: string;
};

export type AgentNotificationStore = {
  createIdempotent(
    notification: CreateAgentNotification,
  ): Promise<{ created: boolean; notification: AgentNotification }>;
  listByOwner(ownerUserId: string, limit?: number): Promise<AgentNotification[]>;
  listByAgent(agentId: string, limit?: number): Promise<AgentNotification[]>;
  markRead(
    notificationId: string,
    ownerUserId: string,
  ): Promise<AgentNotification | null>;
};

function clone(notification: AgentNotification): AgentNotification {
  return structuredClone(notification);
}

export class MemoryAgentNotificationStore implements AgentNotificationStore {
  readonly notifications: AgentNotification[] = [];

  async createIdempotent(input: CreateAgentNotification) {
    const existing = this.notifications.find(
      (notification) =>
        notification.agentId === input.agentId &&
        notification.kind === input.kind &&
        notification.dedupeKey === input.dedupeKey,
    );
    if (existing) return { created: false, notification: clone(existing) };
    const notification: AgentNotification = {
      ...input,
      notificationId: input.notificationId ?? randomUUID(),
      readAt: input.readAt ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.notifications.push(notification);
    return { created: true, notification: clone(notification) };
  }

  async listByOwner(ownerUserId: string, limit = 100) {
    return this.notifications
      .filter((notification) => notification.ownerUserId === ownerUserId)
      .slice(-boundedLimit(limit))
      .reverse()
      .map(clone);
  }

  async listByAgent(agentId: string, limit = 100) {
    return this.notifications
      .filter((notification) => notification.agentId === agentId)
      .slice(-boundedLimit(limit))
      .reverse()
      .map(clone);
  }

  async markRead(notificationId: string, ownerUserId: string) {
    const notification = this.notifications.find(
      (candidate) =>
        candidate.notificationId === notificationId &&
        candidate.ownerUserId === ownerUserId,
    );
    if (!notification) return null;
    notification.readAt ??= new Date().toISOString();
    return clone(notification);
  }

  clear() {
    this.notifications.length = 0;
  }
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 500));
}

function notificationFromRow(row: Record<string, unknown>): AgentNotification {
  const nullable = (name: string) =>
    row[name] == null ? undefined : String(row[name]);
  return {
    notificationId: String(row.notification_id),
    agentId: String(row.agent_id),
    ownerUserId: String(row.owner_user_id),
    kind: String(row.kind) as NotificationKind,
    severity: String(row.severity) as Severity,
    title: String(row.title),
    body: String(row.body),
    dedupeKey: String(row.dedupe_key),
    receiptId: nullable("receipt_id"),
    backRecordId: nullable("back_record_id"),
    retirementId: nullable("retirement_id"),
    correlationId: nullable("correlation_id"),
    readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

let neonSchemaReady = false;
const memoryStore = new MemoryAgentNotificationStore();

class NeonAgentNotificationStore implements AgentNotificationStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  private async ensureSchema() {
    if (neonSchemaReady) return;
    await this.sql`CREATE TABLE IF NOT EXISTS agent_notifications (
      notification_id uuid PRIMARY KEY, agent_id uuid NOT NULL, owner_user_id text NOT NULL,
      kind text NOT NULL, severity text NOT NULL, title text NOT NULL, body text NOT NULL,
      dedupe_key text NOT NULL, receipt_id text, back_record_id uuid, retirement_id uuid,
      correlation_id text, read_at timestamptz, created_at timestamptz NOT NULL,
      UNIQUE (agent_id, kind, dedupe_key)
    )`;
    await this.sql`CREATE INDEX IF NOT EXISTS agent_notifications_owner_created
      ON agent_notifications (owner_user_id, created_at DESC)`;
    neonSchemaReady = true;
  }

  async createIdempotent(input: CreateAgentNotification) {
    await this.ensureSchema();
    const notification: AgentNotification = {
      ...input, notificationId: input.notificationId ?? randomUUID(),
      readAt: input.readAt ?? null, createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await this.sql`INSERT INTO agent_notifications (
      notification_id, agent_id, owner_user_id, kind, severity, title, body, dedupe_key,
      receipt_id, back_record_id, retirement_id, correlation_id, read_at, created_at
    ) VALUES (
      ${notification.notificationId}::uuid, ${notification.agentId}::uuid, ${notification.ownerUserId},
      ${notification.kind}, ${notification.severity}, ${notification.title}, ${notification.body},
      ${notification.dedupeKey}, ${notification.receiptId ?? null}, ${notification.backRecordId ?? null}::uuid,
      ${notification.retirementId ?? null}::uuid, ${notification.correlationId ?? null},
      ${notification.readAt ?? null}::timestamptz, ${notification.createdAt}::timestamptz
    ) ON CONFLICT (agent_id, kind, dedupe_key) DO NOTHING`;
    const rows = await this.sql`SELECT * FROM agent_notifications WHERE agent_id = ${notification.agentId}::uuid
      AND kind = ${notification.kind} AND dedupe_key = ${notification.dedupeKey} LIMIT 1`;
    const existing = notificationFromRow(rows[0] as Record<string, unknown>);
    return { created: existing.notificationId === notification.notificationId, notification: existing };
  }

  async listByOwner(ownerUserId: string, limit = 100) {
    await this.ensureSchema();
    const rows = await this.sql`SELECT * FROM agent_notifications WHERE owner_user_id = ${ownerUserId}
      ORDER BY created_at DESC LIMIT ${boundedLimit(limit)}`;
    return (rows as Record<string, unknown>[]).map(notificationFromRow);
  }

  async listByAgent(agentId: string, limit = 100) {
    await this.ensureSchema();
    const rows = await this.sql`SELECT * FROM agent_notifications WHERE agent_id = ${agentId}::uuid
      ORDER BY created_at DESC LIMIT ${boundedLimit(limit)}`;
    return (rows as Record<string, unknown>[]).map(notificationFromRow);
  }

  async markRead(notificationId: string, ownerUserId: string) {
    await this.ensureSchema();
    const rows = await this.sql`UPDATE agent_notifications SET read_at = COALESCE(read_at, now())
      WHERE notification_id = ${notificationId}::uuid AND owner_user_id = ${ownerUserId} RETURNING *`;
    return rows[0] ? notificationFromRow(rows[0] as Record<string, unknown>) : null;
  }
}

export function getAgentNotificationStore(): AgentNotificationStore {
  const sql = getSql();
  if (sql) return new NeonAgentNotificationStore(sql);
  if (process.env.NODE_ENV === "production") throw new Error("Agent notification storage is not configured.");
  return memoryStore;
}

export function resetAgentNotificationStoreForTests() {
  memoryStore.clear();
}

/** Non-blocking operator signal; notifications never affect execution. */
export function scheduleOperatorNotification(input: CreateAgentNotification): void {
  void getAgentNotificationStore().createIdempotent(input).catch(() => undefined);
}
