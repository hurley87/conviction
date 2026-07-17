import "server-only";
import { getSql } from "@/lib/db";
import { getUserIdentity } from "@/lib/users";
import {
  AgentProvisioningError,
  MemoryAgentProvisioningStore,
  ownedAgentFromRow,
  type AgentProvisioningRecord,
  type AgentProvisioningStore,
  type OwnedAgent,
  type ProvisioningOwner,
} from "@/lib/agent-provisioning";

let schemaReady = false;
const mockStore = new MemoryAgentProvisioningStore();

async function ensureSchema(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id uuid PRIMARY KEY,
      owner_user_id text NOT NULL,
      handle text NOT NULL,
      author_kind text NOT NULL CHECK (author_kind = 'agent'),
      operator_handle text NOT NULL,
      address text,
      return_address text NOT NULL,
      status text NOT NULL CHECK (
        status IN ('provisioning', 'active', 'disabled', 'capped', 'retiring', 'retired')
      ),
      public_status text NOT NULL CHECK (public_status IN ('active', 'paused', 'retired')),
      action_policy jsonb NOT NULL,
      max_trade_usd numeric NOT NULL,
      spend_budget_usd numeric NOT NULL,
      lifetime_spend_usd numeric NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL,
      disabled_at timestamptz,
      retirement_started_at timestamptz,
      retired_at timestamptz,
      active_lease_id text,
      active_lease_expires_at timestamptz
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agents_handle_unique
      ON agents (lower(handle))
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agents_one_non_retired_per_owner
      ON agents (owner_user_id) WHERE status <> 'retired'
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_provisioning_handoffs (
      handoff_id uuid PRIMARY KEY,
      agent_id uuid NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
      code_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      redeemed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  schemaReady = true;
}

class NeonAgentProvisioningStore implements AgentProvisioningStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async create(record: AgentProvisioningRecord): Promise<void> {
    await ensureSchema(this.sql);

    const ownerConflict = await this.sql`
      SELECT 1 FROM agents
      WHERE owner_user_id = ${record.agent.ownerUserId} AND status <> 'retired'
      LIMIT 1
    `;
    if (ownerConflict.length) {
      throw new AgentProvisioningError(
        "agent_exists",
        "This account already has a v1 agent. Retire it before creating another.",
      );
    }

    const handleConflict = await this.sql`
      SELECT 1 FROM agents WHERE lower(handle) = lower(${record.agent.handle})
      UNION ALL
      SELECT 1 FROM users WHERE lower(handle) = lower(${record.agent.handle})
      LIMIT 1
    `;
    if (handleConflict.length) {
      throw new AgentProvisioningError(
        "handle_unavailable",
        "That handle is already in use. Choose a different agent handle.",
      );
    }

    try {
      const inserted = await this.sql`
        WITH created_agent AS (
          INSERT INTO agents (
            agent_id, owner_user_id, handle, author_kind, operator_handle,
            address, return_address, status, public_status, action_policy,
            max_trade_usd, spend_budget_usd, lifetime_spend_usd, created_at
          ) VALUES (
            ${record.agent.agentId}, ${record.agent.ownerUserId},
            ${record.agent.handle}, 'agent', ${record.agent.operatorHandle},
            NULL, ${record.agent.returnAddress}, 'provisioning', 'paused',
            ${JSON.stringify(record.agent.actionPolicy)}::jsonb,
            ${record.agent.maxTradeUsd}, ${record.agent.spendBudgetUsd}, 0,
            ${record.agent.createdAt}
          )
          RETURNING agent_id
        )
        INSERT INTO agent_provisioning_handoffs (
          handoff_id, agent_id, code_hash, expires_at
        )
        SELECT ${record.handoff.handoffId}, agent_id, ${record.handoff.codeHash},
               ${record.handoff.expiresAt}
        FROM created_agent
        RETURNING agent_id
      `;
      if (!inserted.length) {
        throw new AgentProvisioningError(
          "identity_unavailable",
          "We could not reserve an agent identity. Try creating the agent again.",
        );
      }
    } catch (error) {
      if (error instanceof AgentProvisioningError) throw error;
      const constraint = (error as { constraint?: string }).constraint;
      if (constraint === "agents_one_non_retired_per_owner") {
        throw new AgentProvisioningError(
          "agent_exists",
          "This account already has a v1 agent. Retire it before creating another.",
        );
      }
      if (constraint === "agents_handle_unique") {
        throw new AgentProvisioningError(
          "handle_unavailable",
          "That handle was just claimed. Choose a different agent handle.",
        );
      }
      throw error;
    }
  }

  async findNonRetiredByOwner(ownerUserId: string): Promise<OwnedAgent | null> {
    await ensureSchema(this.sql);
    const rows = await this.sql`
      SELECT * FROM agents
      WHERE owner_user_id = ${ownerUserId} AND status <> 'retired'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ? ownedAgentFromRow(rows[0] as Record<string, unknown>) : null;
  }
}

export async function getProvisioningContext(
  userId: string,
  mock: boolean,
): Promise<{ store: AgentProvisioningStore; owner: ProvisioningOwner }> {
  const sql = getSql();
  if (!sql) {
    if (!mock || process.env.NODE_ENV === "production") {
      throw new Error("Agent storage is not configured.");
    }
    return {
      store: mockStore,
      owner: { userId, operatorHandle: "demo-trader" },
    };
  }

  const user = await getUserIdentity(userId);
  if (!user) {
    throw new AgentProvisioningError(
      "profile_missing",
      "Finish signing in with X, then refresh Agent Access and try again.",
    );
  }
  return {
    store: new NeonAgentProvisioningStore(sql),
    owner: {
      userId: user.privyId,
      operatorHandle: user.handle,
    },
  };
}
