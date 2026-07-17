import { describe, expect, it } from "vitest";
import {
  createPendingAgent,
  MemoryAgentProvisioningStore,
  ownedAgentFromRow,
  PROVISIONING_HANDOFF_TTL_MS,
} from "@/lib/agent-provisioning";

const OWNER = { userId: "did:privy:owner-1", operatorHandle: "operator" };
const INPUT = {
  handle: "Signal-Scout",
  returnAddress: "0x0000000000000000000000000000000000000001",
  maxTradeUsd: 25,
  spendBudgetUsd: 100,
  actionPolicy: { trade: true, back: true, publish: false },
};

const FIXED_NOW = new Date("2026-07-16T20:00:00.000Z");

function dependencies() {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  return {
    now: () => FIXED_NOW,
    randomId: () => ids.shift()!,
    randomCode: () => "one-time-provisioning-code",
  };
}

describe("createPendingAgent", () => {
  it("creates one pending identity and returns a ten-minute one-time handoff", async () => {
    const store = new MemoryAgentProvisioningStore();
    const result = await createPendingAgent(store, OWNER, INPUT, dependencies());

    expect(result.agent).toMatchObject({
      ownerUserId: OWNER.userId,
      handle: "signal-scout",
      authorKind: "agent",
      operatorHandle: OWNER.operatorHandle,
      address: null,
      status: "provisioning",
      publicStatus: "paused",
      lifetimeSpendUsd: 0,
    });
    expect(result.handoff).toEqual({
      code: "one-time-provisioning-code",
      command:
        "conviction-mcp init --code one-time-provisioning-code",
      expiresAt: new Date(
        FIXED_NOW.getTime() + PROVISIONING_HANDOFF_TTL_MS,
      ).toISOString(),
    });

    expect(store.records[0]?.handoff.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(store.records[0])).not.toContain(
      "one-time-provisioning-code",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /privateKey|mnemonic|keystore|signerSecret/i,
    );
  });

  it("rejects a second non-retired agent for the same owner", async () => {
    const store = new MemoryAgentProvisioningStore();
    await createPendingAgent(store, OWNER, INPUT, dependencies());

    await expect(
      createPendingAgent(
        store,
        OWNER,
        { ...INPUT, handle: "second-agent" },
        dependencies(),
      ),
    ).rejects.toMatchObject({
      code: "agent_exists",
    });
    expect(store.records).toHaveLength(1);
  });

  it("returns an actionable conflict for human and agent handles", async () => {
    const humanConflict = new MemoryAgentProvisioningStore(
      new Set(["signal-scout"]),
    );
    await expect(
      createPendingAgent(humanConflict, OWNER, INPUT, dependencies()),
    ).rejects.toMatchObject({
      code: "handle_unavailable",
      message: "That handle is already in use. Choose a different agent handle.",
    });

    const agentConflict = new MemoryAgentProvisioningStore();
    await createPendingAgent(agentConflict, OWNER, INPUT, dependencies());
    await expect(
      createPendingAgent(
        agentConflict,
        { userId: "did:privy:owner-2", operatorHandle: "other" },
        INPUT,
        dependencies(),
      ),
    ).rejects.toMatchObject({
      code: "handle_unavailable",
    });
  });

  it("validates identity, recovery address, and budget boundaries", async () => {
    const store = new MemoryAgentProvisioningStore();
    await expect(
      createPendingAgent(
        store,
        OWNER,
        {
          ...INPUT,
          handle: "not valid!",
          returnAddress: "not-an-address",
          spendBudgetUsd: 5,
        },
        dependencies(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(store.records).toHaveLength(0);
  });
});

describe("ownedAgentFromRow", () => {
  it("preserves persisted lifecycle fields instead of inventing provisioning state", () => {
    expect(
      ownedAgentFromRow({
        agent_id: "00000000-0000-4000-8000-000000000099",
        owner_user_id: "did:privy:owner-1",
        handle: "signal-scout",
        operator_handle: "operator",
        address: "0x00000000000000000000000000000000000000aa",
        return_address: "0x0000000000000000000000000000000000000001",
        status: "active",
        public_status: "active",
        action_policy: { trade: true, back: false, publish: true },
        max_trade_usd: "25",
        spend_budget_usd: "100",
        lifetime_spend_usd: "12.5",
        created_at: "2026-07-16T20:00:00.000Z",
      }),
    ).toMatchObject({
      address: "0x00000000000000000000000000000000000000aa",
      status: "active",
      publicStatus: "active",
      lifetimeSpendUsd: 12.5,
    });
  });
});
