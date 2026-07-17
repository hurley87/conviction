import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import {
  buildBackupVerifiedMessage,
  buildProvisioningProofMessage,
  completeAgentBackupVerification,
  createPendingAgent,
  hashProvisioningCode,
  MemoryAgentProvisioningStore,
  ownedAgentFromRow,
  PROVISIONING_HANDOFF_TTL_MS,
  redeemPendingAgent,
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
        funding_ready: true,
        created_at: "2026-07-16T20:00:00.000Z",
      }),
    ).toMatchObject({
      address: "0x00000000000000000000000000000000000000aa",
      status: "active",
      publicStatus: "active",
      lifetimeSpendUsd: 12.5,
      fundingReady: true,
    });
  });
});

describe("redeemPendingAgent", () => {
  async function createHandoff(store: MemoryAgentProvisioningStore) {
    return createPendingAgent(store, OWNER, INPUT, dependencies());
  }

  it("activates the agent with the local signer and keeps funding locked", async () => {
    const store = new MemoryAgentProvisioningStore();
    const created = await createHandoff(store);
    const wallet = Wallet.createRandom();
    const codeHash = hashProvisioningCode(created.handoff.code);
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );

    const agent = await redeemPendingAgent(
      store,
      {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature,
      },
      { now: () => FIXED_NOW },
    );

    expect(agent).toMatchObject({
      agentId: created.agent.agentId,
      address: wallet.address,
      status: "active",
      publicStatus: "active",
      fundingReady: false,
    });
    expect(store.records[0]?.handoff.redeemedAt).toBe(FIXED_NOW.toISOString());
  });

  it("rejects expired, reused, and invalid proofs", async () => {
    const store = new MemoryAgentProvisioningStore();
    const created = await createHandoff(store);
    const wallet = Wallet.createRandom();
    const codeHash = hashProvisioningCode(created.handoff.code);
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );

    await expect(
      redeemPendingAgent(
        store,
        {
          code: created.handoff.code,
          signerAddress: wallet.address,
          proofSignature,
        },
        {
          now: () =>
            new Date(FIXED_NOW.getTime() + PROVISIONING_HANDOFF_TTL_MS + 1),
        },
      ),
    ).rejects.toMatchObject({ code: "handoff_expired" });

    await expect(
      redeemPendingAgent(store, {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature: await Wallet.createRandom().signMessage("wrong"),
      }),
    ).rejects.toMatchObject({ code: "invalid_proof" });

    await redeemPendingAgent(
      store,
      {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature,
      },
      { now: () => FIXED_NOW },
    );

    const other = Wallet.createRandom();
    await expect(
      redeemPendingAgent(
        store,
        {
          code: created.handoff.code,
          signerAddress: other.address,
          proofSignature: await other.signMessage(
            buildProvisioningProofMessage(codeHash, other.address),
          ),
        },
        { now: () => FIXED_NOW },
      ),
    ).rejects.toMatchObject({ code: "handoff_used" });
  });

  it("returns the same agent for an idempotent redeem of the bound address", async () => {
    const store = new MemoryAgentProvisioningStore();
    const created = await createHandoff(store);
    const wallet = Wallet.createRandom();
    const codeHash = hashProvisioningCode(created.handoff.code);
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );
    const payload = {
      code: created.handoff.code,
      signerAddress: wallet.address,
      proofSignature,
    };

    const first = await redeemPendingAgent(store, payload, {
      now: () => FIXED_NOW,
    });
    const second = await redeemPendingAgent(store, payload, {
      now: () => FIXED_NOW,
    });
    expect(second).toEqual(first);
  });

  it("heals a missing redeemed_at when the agent is already bound to the signer", async () => {
    const store = new MemoryAgentProvisioningStore();
    const created = await createHandoff(store);
    const wallet = Wallet.createRandom();
    const codeHash = hashProvisioningCode(created.handoff.code);
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );

    await redeemPendingAgent(
      store,
      {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature,
      },
      { now: () => FIXED_NOW },
    );

    // Simulate a partial write: agent active, handoff mark lost.
    store.records[0]!.handoff.redeemedAt = null;

    const healed = await redeemPendingAgent(
      store,
      {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature,
      },
      { now: () => FIXED_NOW },
    );

    expect(healed.address).toBe(wallet.address);
    expect(healed.status).toBe("active");
    expect(store.records[0]?.handoff.redeemedAt).toBe(FIXED_NOW.toISOString());
  });
});

describe("completeAgentBackupVerification", () => {
  it("unlocks funding only after a matching backup proof", async () => {
    const store = new MemoryAgentProvisioningStore();
    const created = await createPendingAgent(store, OWNER, INPUT, dependencies());
    const wallet = Wallet.createRandom();
    const codeHash = hashProvisioningCode(created.handoff.code);
    await redeemPendingAgent(
      store,
      {
        code: created.handoff.code,
        signerAddress: wallet.address,
        proofSignature: await wallet.signMessage(
          buildProvisioningProofMessage(codeHash, wallet.address),
        ),
      },
      { now: () => FIXED_NOW },
    );

    const agent = await completeAgentBackupVerification(store, {
      agentId: created.agent.agentId,
      signerAddress: wallet.address,
      proofSignature: await wallet.signMessage(
        buildBackupVerifiedMessage(created.agent.agentId, wallet.address),
      ),
    });

    expect(agent.fundingReady).toBe(true);
    expect(agent.address).toBe(wallet.address);
  });
});
