import { describe, expect, it } from "vitest";
import { MemoryAgentAuditStore } from "@/lib/agent-audit";
import { MemorySpendLedger } from "@/lib/agent-execute";
import {
  MemoryAgentPermitStore,
  type ExecutionPermitRecord,
} from "@/lib/agent-permit";
import {
  commitAgentSpend,
  disableAgent,
  enableAgent,
  privatePausedReason,
  updateAgentPolicy,
} from "@/lib/agent-policy";
import {
  createPendingAgent,
  MemoryAgentProvisioningStore,
  type OwnedAgent,
} from "@/lib/agent-provisioning";

const OWNER = { userId: "did:privy:owner-1", operatorHandle: "operator" };
const OTHER = { userId: "did:privy:other", operatorHandle: "other" };
const FIXED_NOW = new Date("2026-07-18T12:00:00.000Z");

async function seedActiveAgent(
  store: MemoryAgentProvisioningStore,
  overrides: Partial<OwnedAgent> = {},
): Promise<OwnedAgent> {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const created = await createPendingAgent(
    store,
    OWNER,
    {
      handle: "policy-scout",
      returnAddress: "0x0000000000000000000000000000000000000001",
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      actionPolicy: { trade: true, back: true, publish: true },
    },
    {
      now: () => FIXED_NOW,
      randomId: () => ids.shift()!,
      randomCode: () => "policy-test-code",
      apiBaseUrl: "https://app.getconviction.com",
    },
  );

  const record = store.records.find(
    ({ agent }) => agent.agentId === created.agent.agentId,
  );
  if (!record) throw new Error("missing seeded agent");
  record.agent.address = "0x00000000000000000000000000000000000000Aa";
  record.agent.status = "active";
  record.agent.publicStatus = "active";
  record.agent.fundingReady = true;
  Object.assign(record.agent, overrides);
  return record.agent;
}

function issuedPermit(
  agentId: string,
  permitId: string,
): ExecutionPermitRecord {
  return {
    permitId,
    agentId,
    leaseId: "lease-1",
    quoteId: "33333333-3333-4333-8333-333333333333",
    quoteFingerprint: "fp-1",
    idempotencyKey: `idem-${permitId}`,
    action: "trade",
    dollarsIn: 10,
    floorUsd: 9,
    intent: {
      toAsset: "eth",
      sizeUsd: 10,
      destChain: "Arbitrum",
    },
    sizeUsd: 10,
    agreedQuote: {
      dollarsIn: 10,
      dollarsOut: 9.5,
      feeUsd: 0.1,
      etaSeconds: 45,
      floorUsd: 9,
      sourceChain: "Arbitrum",
      destChain: "Arbitrum",
      toAsset: "eth",
      transactionId: "tx-1",
      rawTransaction: {},
    },
    rawTransaction: {},
    issuedAt: FIXED_NOW.toISOString(),
    expiresAt: new Date(FIXED_NOW.getTime() + 30_000).toISOString(),
    status: "issued",
  };
}

describe("updateAgentPolicy", () => {
  it("raises and lowers caps, toggles actions, and audits the change", async () => {
    const store = new MemoryAgentProvisioningStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);

    const result = await updateAgentPolicy({
      store,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      untrustedInput: {
        maxTradeUsd: 40,
        spendBudgetUsd: 200,
        actionPolicy: { trade: true, back: false, publish: true },
      },
      now: FIXED_NOW,
    });

    expect(result.agent).toMatchObject({
      maxTradeUsd: 40,
      spendBudgetUsd: 200,
      actionPolicy: { trade: true, back: false, publish: true },
      status: "active",
      publicStatus: "active",
    });
    expect(auditStore.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "budget_changed",
        "action_toggled",
        "policy_updated",
      ]),
    );
  });

  it("rejects foreign owners and refuses MCP-shaped unauthenticated use via ownership check", async () => {
    const store = new MemoryAgentProvisioningStore();
    const agent = await seedActiveAgent(store);

    await expect(
      updateAgentPolicy({
        store,
        auditStore: new MemoryAgentAuditStore(),
        permitStore: new MemoryAgentPermitStore(),
        spendLedger: new MemorySpendLedger(),
        ownerUserId: OTHER.userId,
        agentId: agent.agentId,
        untrustedInput: { spendBudgetUsd: 150 },
      }),
    ).rejects.toMatchObject({ code: "agent_not_found" });
  });

  it("caps when budget is lowered to lifetime spend and restores active when raised", async () => {
    const store = new MemoryAgentProvisioningStore();
    const auditStore = new MemoryAgentAuditStore();
    const agent = await seedActiveAgent(store, { lifetimeSpendUsd: 80 });

    const capped = await updateAgentPolicy({
      store,
      auditStore,
      permitStore: new MemoryAgentPermitStore(),
      spendLedger: new MemorySpendLedger(),
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      untrustedInput: { spendBudgetUsd: 80 },
      now: FIXED_NOW,
    });

    expect(capped.agent.status).toBe("capped");
    expect(capped.agent.publicStatus).toBe("paused");
    expect(privatePausedReason(capped.agent)).toMatch(/exhausted/i);
    expect(auditStore.events.some((event) => event.type === "capped")).toBe(
      true,
    );

    const restored = await updateAgentPolicy({
      store,
      auditStore,
      permitStore: new MemoryAgentPermitStore(),
      spendLedger: new MemorySpendLedger(),
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      untrustedInput: { spendBudgetUsd: 120 },
      now: FIXED_NOW,
    });

    expect(restored.agent.status).toBe("active");
    expect(restored.agent.publicStatus).toBe("active");
    expect(auditStore.events.some((event) => event.type === "cap_lifted")).toBe(
      true,
    );
  });

  it("does not lift a cap while independently disabled", async () => {
    const store = new MemoryAgentProvisioningStore();
    const agent = await seedActiveAgent(store, {
      lifetimeSpendUsd: 80,
      status: "disabled",
      publicStatus: "paused",
    });

    const result = await updateAgentPolicy({
      store,
      auditStore: new MemoryAgentAuditStore(),
      permitStore: new MemoryAgentPermitStore(),
      spendLedger: new MemorySpendLedger(),
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      untrustedInput: { spendBudgetUsd: 200 },
      now: FIXED_NOW,
    });

    expect(result.agent.status).toBe("disabled");
    expect(result.agent.publicStatus).toBe("paused");
    expect(result.agent.spendBudgetUsd).toBe(200);
  });

  it("releases outstanding trade permits when trade is disabled", async () => {
    const store = new MemoryAgentProvisioningStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    await permitStore.save(issuedPermit(agent.agentId, "44444444-4444-4444-8444-444444444444"));
    spendLedger.tryReserve({
      agentId: agent.agentId,
      dollarsIn: 10,
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      lifetimeSpendUsd: 0,
    });

    const result = await updateAgentPolicy({
      store,
      auditStore: new MemoryAgentAuditStore(),
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      untrustedInput: { actionPolicy: { trade: false } },
      now: FIXED_NOW,
    });

    expect(result.releasedPermitCount).toBe(1);
    expect(
      (await permitStore.get("44444444-4444-4444-8444-444444444444"))?.status,
    ).toBe("released");
  });
});

describe("disableAgent / enableAgent", () => {
  it("disables immediately, releases permits, and restores writes on enable", async () => {
    const store = new MemoryAgentProvisioningStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store);
    await permitStore.save(issuedPermit(agent.agentId, "55555555-5555-4555-8555-555555555555"));

    const disabled = await disableAgent({
      store,
      auditStore,
      permitStore,
      spendLedger,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    expect(disabled.agent.status).toBe("disabled");
    expect(disabled.agent.publicStatus).toBe("paused");
    expect(disabled.releasedPermitCount).toBe(1);
    expect(privatePausedReason(disabled.agent)).toMatch(/independently disabled/i);
    expect(auditStore.events.some((event) => event.type === "disabled")).toBe(
      true,
    );

    const enabled = await enableAgent({
      store,
      auditStore,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    expect(enabled.agent.status).toBe("active");
    expect(enabled.agent.publicStatus).toBe("active");
    expect(auditStore.events.some((event) => event.type === "enabled")).toBe(
      true,
    );
  });

  it("re-enabling with exhausted budget stays privately capped", async () => {
    const store = new MemoryAgentProvisioningStore();
    const auditStore = new MemoryAgentAuditStore();
    const agent = await seedActiveAgent(store, {
      lifetimeSpendUsd: 100,
      spendBudgetUsd: 100,
      status: "disabled",
      publicStatus: "paused",
    });

    const enabled = await enableAgent({
      store,
      auditStore,
      ownerUserId: OWNER.userId,
      agentId: agent.agentId,
      now: FIXED_NOW,
    });

    expect(enabled.agent.status).toBe("capped");
    expect(enabled.agent.publicStatus).toBe("paused");
    expect(privatePausedReason(enabled.agent)).toMatch(/exhausted/i);
  });
});

describe("addLifetimeSpend auto-cap", () => {
  it("transitions active agents to capped when remaining budget hits zero", async () => {
    const store = new MemoryAgentProvisioningStore();
    const agent = await seedActiveAgent(store, {
      spendBudgetUsd: 50,
      lifetimeSpendUsd: 40,
    });

    const updated = await store.addLifetimeSpend({
      agentId: agent.agentId,
      dollarsIn: 10,
    });

    expect(updated.status).toBe("capped");
    expect(updated.publicStatus).toBe("paused");
    expect(updated.lifetimeSpendUsd).toBe(50);
  });

  it("does not override independent disablement when spend exhausts budget", async () => {
    const store = new MemoryAgentProvisioningStore();
    const agent = await seedActiveAgent(store, {
      spendBudgetUsd: 50,
      lifetimeSpendUsd: 40,
      status: "disabled",
      publicStatus: "paused",
    });

    const updated = await store.addLifetimeSpend({
      agentId: agent.agentId,
      dollarsIn: 10,
    });

    expect(updated.status).toBe("disabled");
    expect(updated.lifetimeSpendUsd).toBe(50);
  });
});

describe("commitAgentSpend", () => {
  it("releases outstanding permits and audits when spend newly caps the agent", async () => {
    const store = new MemoryAgentProvisioningStore();
    const auditStore = new MemoryAgentAuditStore();
    const permitStore = new MemoryAgentPermitStore();
    const spendLedger = new MemorySpendLedger();
    const agent = await seedActiveAgent(store, {
      spendBudgetUsd: 50,
      lifetimeSpendUsd: 40,
    });
    await permitStore.save(
      issuedPermit(agent.agentId, "88888888-8888-4888-8888-888888888888"),
    );
    spendLedger.tryReserve({
      agentId: agent.agentId,
      dollarsIn: 10,
      maxTradeUsd: 25,
      spendBudgetUsd: 50,
      lifetimeSpendUsd: 40,
    });

    const result = await commitAgentSpend({
      store,
      auditStore,
      permitStore,
      spendLedger,
      agentId: agent.agentId,
      dollarsIn: 10,
      previousStatus: "active",
      now: FIXED_NOW,
    });

    expect(result.agent.status).toBe("capped");
    expect(result.releasedPermitCount).toBe(1);
    expect(
      (await permitStore.get("88888888-8888-4888-8888-888888888888"))?.status,
    ).toBe("released");
    expect(spendLedger.reservedUsd(agent.agentId)).toBe(0);
    expect(auditStore.events.some((event) => event.type === "capped")).toBe(
      true,
    );
  });
});
