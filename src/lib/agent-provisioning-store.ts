import "server-only";
import { getAddress } from "ethers";
import { getSql } from "@/lib/db";
import { getUserIdentity } from "@/lib/users";
import {
  AgentProvisioningError,
  MemoryAgentProvisioningStore,
  ownedAgentFromRow,
  type AgentProvisioningRecord,
  type AgentProvisioningStore,
  type HandoffLookup,
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
      funding_ready boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      disabled_at timestamptz,
      retirement_started_at timestamptz,
      retired_at timestamptz,
      active_lease_id text,
      active_lease_expires_at timestamptz
    )
  `;
  await sql`
    ALTER TABLE agents
      ADD COLUMN IF NOT EXISTS funding_ready boolean NOT NULL DEFAULT false
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

function handoffFromRow(row: Record<string, unknown>) {
  const redeemedRaw = row.redeemed_at;
  return {
    handoffId: String(row.handoff_id),
    agentId: String(row.agent_id),
    codeHash: String(row.code_hash),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    redeemedAt:
      redeemedRaw === null || redeemedRaw === undefined
        ? null
        : new Date(String(redeemedRaw)).toISOString(),
  };
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
            max_trade_usd, spend_budget_usd, lifetime_spend_usd, funding_ready,
            created_at
          ) VALUES (
            ${record.agent.agentId}, ${record.agent.ownerUserId},
            ${record.agent.handle}, 'agent', ${record.agent.operatorHandle},
            NULL, ${record.agent.returnAddress}, 'provisioning', 'paused',
            ${JSON.stringify(record.agent.actionPolicy)}::jsonb,
            ${record.agent.maxTradeUsd}, ${record.agent.spendBudgetUsd}, 0,
            false, ${record.agent.createdAt}
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

  async findHandoffByCodeHash(codeHash: string): Promise<HandoffLookup | null> {
    await ensureSchema(this.sql);
    const rows = await this.sql`
      SELECT
        h.handoff_id, h.agent_id, h.code_hash, h.expires_at, h.redeemed_at,
        a.*
      FROM agent_provisioning_handoffs h
      INNER JOIN agents a ON a.agent_id = h.agent_id
      WHERE h.code_hash = ${codeHash}
      LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      handoff: handoffFromRow(row),
      agent: ownedAgentFromRow(row),
    };
  }

  async redeemHandoff(input: {
    codeHash: string;
    signerAddress: string;
    now: Date;
  }): Promise<OwnedAgent> {
    await ensureSchema(this.sql);
    const normalized = getAddress(input.signerAddress);
    const lookup = await this.findHandoffByCodeHash(input.codeHash);
    if (!lookup) {
      throw new AgentProvisioningError(
        "handoff_not_found",
        "That provisioning code was not found. Create a new agent handoff in Agent Access.",
      );
    }

    const { handoff, agent } = lookup;
    const nowIso = input.now.toISOString();

    // Already bound to this signer: heal a missing redeemed_at and return.
    if (
      agent.address &&
      getAddress(agent.address) === normalized &&
      agent.status !== "provisioning"
    ) {
      if (!handoff.redeemedAt) {
        await this.sql`
          UPDATE agent_provisioning_handoffs
          SET redeemed_at = ${nowIso}::timestamptz
          WHERE handoff_id = ${handoff.handoffId}
            AND redeemed_at IS NULL
        `;
      }
      return agent;
    }

    if (handoff.redeemedAt) {
      throw new AgentProvisioningError(
        "handoff_used",
        "That provisioning code was already redeemed. Resume from the existing local profile.",
      );
    }

    if (new Date(handoff.expiresAt).getTime() <= input.now.getTime()) {
      throw new AgentProvisioningError(
        "handoff_expired",
        "That provisioning code expired. Create a new agent handoff in Agent Access.",
      );
    }

    if (agent.status !== "provisioning") {
      throw new AgentProvisioningError(
        "agent_not_pending",
        "This agent is no longer awaiting local provisioning.",
      );
    }

    if (agent.address && getAddress(agent.address) !== normalized) {
      throw new AgentProvisioningError(
        "address_mismatch",
        "A different signer address is already bound to this agent.",
      );
    }

    // Activate + mark handoff in one statement so a partial update cannot stick.
    const updated = await this.sql`
      WITH activated AS (
        UPDATE agents
        SET
          address = ${normalized},
          status = 'active',
          public_status = 'active',
          funding_ready = false
        WHERE agent_id = ${agent.agentId}
          AND status = 'provisioning'
          AND (address IS NULL OR lower(address) = lower(${normalized}))
        RETURNING *
      ),
      marked AS (
        UPDATE agent_provisioning_handoffs
        SET redeemed_at = ${nowIso}::timestamptz
        WHERE handoff_id = ${handoff.handoffId}
          AND redeemed_at IS NULL
          AND EXISTS (SELECT 1 FROM activated)
        RETURNING handoff_id
      )
      SELECT * FROM activated
    `;
    if (updated[0]) {
      return ownedAgentFromRow(updated[0] as Record<string, unknown>);
    }

    const again = await this.findHandoffByCodeHash(input.codeHash);
    if (
      again?.agent.address &&
      getAddress(again.agent.address) === normalized &&
      again.agent.status !== "provisioning"
    ) {
      if (!again.handoff.redeemedAt) {
        await this.sql`
          UPDATE agent_provisioning_handoffs
          SET redeemed_at = ${nowIso}::timestamptz
          WHERE handoff_id = ${again.handoff.handoffId}
            AND redeemed_at IS NULL
        `;
      }
      return again.agent;
    }

    throw new AgentProvisioningError(
      "identity_unavailable",
      "Could not redeem the provisioning handoff. Try again.",
    );
  }

  async markFundingReady(input: {
    agentId: string;
    signerAddress: string;
  }): Promise<OwnedAgent> {
    await ensureSchema(this.sql);
    const normalized = getAddress(input.signerAddress);

    const updated = await this.sql`
      UPDATE agents
      SET funding_ready = true
      WHERE agent_id = ${input.agentId}
        AND address IS NOT NULL
        AND lower(address) = lower(${normalized})
        AND status NOT IN ('retired', 'retiring')
      RETURNING *
    `;

    if (updated[0]) {
      return ownedAgentFromRow(updated[0] as Record<string, unknown>);
    }

    const rows = await this.sql`
      SELECT * FROM agents WHERE agent_id = ${input.agentId} LIMIT 1
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No agent matches that identity.",
      );
    }

    const agent = ownedAgentFromRow(row);
    if (!agent.address) {
      throw new AgentProvisioningError(
        "agent_not_pending",
        "Redeem a provisioning handoff before verifying the signer backup.",
      );
    }
    if (getAddress(agent.address) !== normalized) {
      throw new AgentProvisioningError(
        "address_mismatch",
        "The backup proof does not match the bound agent signer.",
      );
    }
    if (agent.status === "retired" || agent.status === "retiring") {
      throw new AgentProvisioningError(
        "agent_not_pending",
        "A retired or retiring agent cannot become funding-ready.",
      );
    }

    throw new AgentProvisioningError(
      "identity_unavailable",
      "Could not mark the agent funding-ready. Try again.",
    );
  }
}

/**
 * Store accessor for CLI redeem/complete paths that authenticate via
 * one-time code + proof-of-possession rather than a Privy session.
 */
export function getPublicAgentProvisioningStore(): AgentProvisioningStore {
  const sql = getSql();
  if (sql) return new NeonAgentProvisioningStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent storage is not configured.");
  }
  return mockStore;
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
