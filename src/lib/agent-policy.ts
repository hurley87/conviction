import { z } from "zod";
import {
  buildAuditEvent,
  type AgentAuditStore,
} from "@/lib/agent-audit";
import {
  AgentProvisioningError,
  createAgentSchema,
  type AgentProvisioningStore,
  type AgentPublicStatus,
  type AgentStatus,
  type CreateAgentInput,
  type OwnedAgent,
} from "@/lib/agent-provisioning";
import type {
  AgentPermitStore,
  AgentSpendLedger,
  ExecutionPermitRecord,
} from "@/lib/agent-permit";

type PermitInvalidator = {
  permitStore: AgentPermitStore;
  spendLedger: AgentSpendLedger;
};

const actionPolicyPatchSchema = z
  .object({
    trade: z.boolean().optional(),
    back: z.boolean().optional(),
    publish: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.trade !== undefined ||
      value.back !== undefined ||
      value.publish !== undefined,
    { message: "Provide at least one action permission to change." },
  );

export const updateAgentPolicySchema = z
  .object({
    maxTradeUsd: createAgentSchema.shape.maxTradeUsd.optional(),
    spendBudgetUsd: createAgentSchema.shape.spendBudgetUsd.optional(),
    actionPolicy: actionPolicyPatchSchema.optional(),
  })
  .refine(
    (value) =>
      value.maxTradeUsd !== undefined ||
      value.spendBudgetUsd !== undefined ||
      value.actionPolicy !== undefined,
    { message: "Provide at least one policy field to update." },
  );

export type UpdateAgentPolicyInput = z.infer<typeof updateAgentPolicySchema>;

export type PolicyMutationResult = {
  agent: OwnedAgent;
  /** Count of outstanding issued permits released by this mutation. */
  releasedPermitCount: number;
};

const MUTABLE_STATUSES = new Set<AgentStatus>([
  "provisioning",
  "active",
  "disabled",
  "capped",
]);

function remainingBudgetUsd(agent: Pick<OwnedAgent, "spendBudgetUsd" | "lifetimeSpendUsd">): number {
  return Math.max(0, agent.spendBudgetUsd - agent.lifetimeSpendUsd);
}

function assertMutableLifecycle(agent: OwnedAgent): void {
  if (!MUTABLE_STATUSES.has(agent.status)) {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and cannot change operator policy.`,
    );
  }
}

function assertOwner(agent: OwnedAgent, ownerUserId: string): void {
  if (agent.ownerUserId !== ownerUserId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
}

function resolveBudgetStatus(input: {
  currentStatus: AgentStatus;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
}): { status: AgentStatus; publicStatus: AgentPublicStatus } {
  if (input.currentStatus === "disabled") {
    return { status: "disabled", publicStatus: "paused" };
  }
  if (input.currentStatus === "provisioning") {
    return { status: "provisioning", publicStatus: "paused" };
  }
  if (input.spendBudgetUsd <= input.lifetimeSpendUsd) {
    return { status: "capped", publicStatus: "paused" };
  }
  return { status: "active", publicStatus: "active" };
}

/** Release issued permits (and their spend reservations) for an agent/action. */
export async function releaseIssuedPermits(options: {
  permitStore: AgentPermitStore;
  spendLedger: AgentSpendLedger;
  agentId: string;
  action?: ExecutionPermitRecord["action"];
}): Promise<number> {
  const issued = await options.permitStore.listIssuedByAgent(options.agentId);
  let released = 0;
  for (const permit of issued) {
    if (options.action && permit.action !== options.action) continue;
    const ok = await options.permitStore.casStatus(
      permit.permitId,
      "issued",
      "released",
    );
    if (!ok) continue;
    await options.spendLedger.release(options.agentId, permit.dollarsIn);
    released += 1;
  }
  return released;
}

/**
 * Operator-authenticated policy update for caps and independent action flags.
 * Takes effect on the next permit request; MCP tools cannot invoke this path.
 */
export async function updateAgentPolicy(
  options: {
    store: AgentProvisioningStore;
    auditStore: AgentAuditStore;
    ownerUserId: string;
    agentId: string;
    untrustedInput: unknown;
    actor?: "operator";
    now?: Date;
  } & PermitInvalidator,
): Promise<PolicyMutationResult> {
  const parsed = updateAgentPolicySchema.safeParse(options.untrustedInput);
  if (!parsed.success) {
    throw new AgentProvisioningError(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Check the policy update and try again.",
    );
  }

  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);
  assertMutableLifecycle(agent);

  const nextMax =
    parsed.data.maxTradeUsd !== undefined
      ? parsed.data.maxTradeUsd
      : agent.maxTradeUsd;
  const nextBudget =
    parsed.data.spendBudgetUsd !== undefined
      ? parsed.data.spendBudgetUsd
      : agent.spendBudgetUsd;
  const nextActions: CreateAgentInput["actionPolicy"] = {
    trade:
      parsed.data.actionPolicy?.trade !== undefined
        ? parsed.data.actionPolicy.trade
        : agent.actionPolicy.trade,
    back:
      parsed.data.actionPolicy?.back !== undefined
        ? parsed.data.actionPolicy.back
        : agent.actionPolicy.back,
    publish:
      parsed.data.actionPolicy?.publish !== undefined
        ? parsed.data.actionPolicy.publish
        : agent.actionPolicy.publish,
  };

  if (nextBudget < nextMax) {
    throw new AgentProvisioningError(
      "invalid_request",
      "The spend budget must cover at least one maximum-size trade.",
    );
  }

  const now = options.now ?? new Date();
  // Snapshot before mutating — memory store updates the same object in place.
  const before = {
    status: agent.status,
    publicStatus: agent.publicStatus,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    lifetimeSpendUsd: agent.lifetimeSpendUsd,
    actionPolicy: { ...agent.actionPolicy },
    remainingBudgetUsd: remainingBudgetUsd(agent),
  };
  const lifecycle = resolveBudgetStatus({
    currentStatus: before.status,
    spendBudgetUsd: nextBudget,
    lifetimeSpendUsd: before.lifetimeSpendUsd,
  });

  const updated = await options.store.updatePolicy({
    agentId: agent.agentId,
    ownerUserId: options.ownerUserId,
    maxTradeUsd: nextMax,
    spendBudgetUsd: nextBudget,
    actionPolicy: nextActions,
    status: lifecycle.status,
    publicStatus: lifecycle.publicStatus,
    // Store keeps an existing disabled_at when status stays disabled.
    disabledAt:
      lifecycle.status === "disabled" ? now.toISOString() : null,
  });

  const actor = options.actor ?? "operator";
  const auditEvents = [];

  if (
    nextBudget !== before.spendBudgetUsd ||
    nextMax !== before.maxTradeUsd
  ) {
    auditEvents.push(
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "budget_changed",
        actor,
        now,
        details: {
          before: {
            maxTradeUsd: before.maxTradeUsd,
            spendBudgetUsd: before.spendBudgetUsd,
            lifetimeSpendUsd: before.lifetimeSpendUsd,
            remainingBudgetUsd: before.remainingBudgetUsd,
          },
          after: {
            maxTradeUsd: nextMax,
            spendBudgetUsd: nextBudget,
            lifetimeSpendUsd: updated.lifetimeSpendUsd,
            remainingBudgetUsd: remainingBudgetUsd(updated),
          },
        },
      }),
    );
  }

  const toggledActions: Array<"trade" | "back" | "publish"> = [];
  for (const action of ["trade", "back", "publish"] as const) {
    if (before.actionPolicy[action] !== nextActions[action]) {
      toggledActions.push(action);
    }
  }
  if (toggledActions.length > 0) {
    auditEvents.push(
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "action_toggled",
        actor,
        now,
        details: {
          before: before.actionPolicy,
          after: nextActions,
          toggled: toggledActions,
        },
      }),
    );
  }

  auditEvents.push(
    buildAuditEvent({
      agentId: agent.agentId,
      ownerUserId: agent.ownerUserId,
      type: "policy_updated",
      actor,
      now,
      details: {
        before: {
          status: before.status,
          publicStatus: before.publicStatus,
          maxTradeUsd: before.maxTradeUsd,
          spendBudgetUsd: before.spendBudgetUsd,
          actionPolicy: before.actionPolicy,
        },
        after: {
          status: updated.status,
          publicStatus: updated.publicStatus,
          maxTradeUsd: updated.maxTradeUsd,
          spendBudgetUsd: updated.spendBudgetUsd,
          actionPolicy: updated.actionPolicy,
        },
      },
    }),
  );

  if (before.status !== "capped" && updated.status === "capped") {
    auditEvents.push(
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "capped",
        actor: "system",
        now,
        details: {
          reason: "spend_budget_at_or_below_lifetime",
          spendBudgetUsd: updated.spendBudgetUsd,
          lifetimeSpendUsd: updated.lifetimeSpendUsd,
          remainingBudgetUsd: remainingBudgetUsd(updated),
        },
      }),
    );
  }
  if (before.status === "capped" && updated.status === "active") {
    auditEvents.push(
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "cap_lifted",
        actor: "system",
        now,
        details: {
          spendBudgetUsd: updated.spendBudgetUsd,
          lifetimeSpendUsd: updated.lifetimeSpendUsd,
          remainingBudgetUsd: remainingBudgetUsd(updated),
        },
      }),
    );
  }

  // Invalidate outstanding permits before audit so a failed audit cannot leave
  // write authority intact after a pause / action disable / cap.
  let releasedPermitCount = 0;
  const shouldReleaseAllWrites =
    updated.status === "disabled" || updated.status === "capped";
  const tradeDisabled =
    before.actionPolicy.trade && !updated.actionPolicy.trade;

  if (shouldReleaseAllWrites || tradeDisabled) {
    releasedPermitCount = await releaseIssuedPermits({
      permitStore: options.permitStore,
      spendLedger: options.spendLedger,
      agentId: updated.agentId,
      ...(tradeDisabled && !shouldReleaseAllWrites ? { action: "trade" } : {}),
    });
  }

  await appendAuditEventsBestEffort(options.auditStore, auditEvents);

  return { agent: updated, releasedPermitCount };
}

async function appendAuditEventsBestEffort(
  auditStore: AgentAuditStore,
  events: Array<ReturnType<typeof buildAuditEvent>>,
): Promise<void> {
  for (const event of events) {
    try {
      await auditStore.append(event);
    } catch (error) {
      console.error("Failed to append agent audit event", {
        type: event.type,
        agentId: event.agentId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

/**
 * Reversible disablement: blocks new write permits immediately; identity and
 * funds remain intact. Public profile shows Paused.
 */
export async function disableAgent(
  options: {
    store: AgentProvisioningStore;
    auditStore: AgentAuditStore;
    ownerUserId: string;
    agentId: string;
    now?: Date;
  } & PermitInvalidator,
): Promise<PolicyMutationResult> {
  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);
  assertMutableLifecycle(agent);

  if (agent.status === "disabled") {
    return { agent, releasedPermitCount: 0 };
  }

  const now = options.now ?? new Date();
  const beforeStatus = agent.status;
  const updated = await options.store.updatePolicy({
    agentId: agent.agentId,
    ownerUserId: options.ownerUserId,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    actionPolicy: agent.actionPolicy,
    status: "disabled",
    publicStatus: "paused",
    disabledAt: now.toISOString(),
  });

  const releasedPermitCount = await releaseIssuedPermits({
    permitStore: options.permitStore,
    spendLedger: options.spendLedger,
    agentId: updated.agentId,
  });

  await appendAuditEventsBestEffort(options.auditStore, [
    buildAuditEvent({
      agentId: agent.agentId,
      ownerUserId: agent.ownerUserId,
      type: "disabled",
      actor: "operator",
      now,
      details: {
        beforeStatus,
        publicStatus: "paused",
      },
    }),
  ]);

  return { agent: updated, releasedPermitCount };
}

/**
 * Re-enable after disablement. Restores Active when budget remains; otherwise
 * private capped / public Paused. Does not reprovision.
 */
export async function enableAgent(options: {
  store: AgentProvisioningStore;
  auditStore: AgentAuditStore;
  ownerUserId: string;
  agentId: string;
  now?: Date;
}): Promise<PolicyMutationResult> {
  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);

  if (agent.status === "retiring" || agent.status === "retired") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and cannot be re-enabled.`,
    );
  }

  if (agent.status !== "disabled") {
    // Idempotent: already active/capped/provisioning.
    return { agent, releasedPermitCount: 0 };
  }

  const now = options.now ?? new Date();
  const lifecycle = resolveBudgetStatus({
    currentStatus: "active",
    spendBudgetUsd: agent.spendBudgetUsd,
    lifetimeSpendUsd: agent.lifetimeSpendUsd,
  });
  // Provisioning agents return to provisioning when re-enabled from a mistaken disable.
  const status: AgentStatus =
    agent.address === null ? "provisioning" : lifecycle.status;
  const publicStatus: AgentPublicStatus =
    status === "active" ? "active" : "paused";

  const updated = await options.store.updatePolicy({
    agentId: agent.agentId,
    ownerUserId: options.ownerUserId,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    actionPolicy: agent.actionPolicy,
    status,
    publicStatus,
    disabledAt: null,
  });

  const enableAudit = [
    buildAuditEvent({
      agentId: agent.agentId,
      ownerUserId: agent.ownerUserId,
      type: "enabled",
      actor: "operator",
      now,
      details: {
        beforeStatus: "disabled",
        afterStatus: updated.status,
        publicStatus: updated.publicStatus,
        remainingBudgetUsd: remainingBudgetUsd(updated),
      },
    }),
  ];
  if (updated.status === "capped") {
    enableAudit.push(
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "capped",
        actor: "system",
        now,
        details: {
          reason: "enabled_with_exhausted_budget",
          spendBudgetUsd: updated.spendBudgetUsd,
          lifetimeSpendUsd: updated.lifetimeSpendUsd,
          remainingBudgetUsd: 0,
        },
      }),
    );
  }
  await appendAuditEventsBestEffort(options.auditStore, enableAudit);

  return { agent: updated, releasedPermitCount: 0 };
}

/**
 * Record counted spend, auto-cap when remaining budget hits zero, and invalidate
 * outstanding issued permits when the agent newly becomes capped.
 */
export async function commitAgentSpend(options: {
  store: AgentProvisioningStore;
  auditStore: AgentAuditStore;
  permitStore: AgentPermitStore;
  spendLedger: AgentSpendLedger;
  agentId: string;
  dollarsIn: number;
  previousStatus: AgentStatus;
  now?: Date;
}): Promise<{ agent: OwnedAgent; releasedPermitCount: number }> {
  const agent = await options.store.addLifetimeSpend({
    agentId: options.agentId,
    dollarsIn: options.dollarsIn,
  });

  const newlyCapped =
    options.previousStatus === "active" && agent.status === "capped";
  let releasedPermitCount = 0;
  if (newlyCapped) {
    releasedPermitCount = await releaseIssuedPermits({
      permitStore: options.permitStore,
      spendLedger: options.spendLedger,
      agentId: agent.agentId,
    });
    await appendAuditEventsBestEffort(options.auditStore, [
      buildAuditEvent({
        agentId: agent.agentId,
        ownerUserId: agent.ownerUserId,
        type: "capped",
        actor: "system",
        now: options.now ?? new Date(),
        details: {
          reason: "lifetime_spend_exhausted_budget",
          spendBudgetUsd: agent.spendBudgetUsd,
          lifetimeSpendUsd: agent.lifetimeSpendUsd,
          remainingBudgetUsd: remainingBudgetUsd(agent),
        },
      }),
    ]);
  }

  return { agent, releasedPermitCount };
}

/**
 * Agent-signer lifecycle path used by `conviction-mcp disable|enable`.
 * Ownership is the bound signer; MCP tools never call these endpoints.
 */
export async function disableAgentBySigner(
  options: {
    store: AgentProvisioningStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    now?: Date;
  } & PermitInvalidator,
): Promise<PolicyMutationResult> {
  return disableAgent({
    store: options.store,
    auditStore: options.auditStore,
    permitStore: options.permitStore,
    spendLedger: options.spendLedger,
    ownerUserId: options.agent.ownerUserId,
    agentId: options.agent.agentId,
    ...(options.now ? { now: options.now } : {}),
  });
}

export async function enableAgentBySigner(options: {
  store: AgentProvisioningStore;
  auditStore: AgentAuditStore;
  agent: OwnedAgent;
  now?: Date;
}): Promise<PolicyMutationResult> {
  return enableAgent({
    store: options.store,
    auditStore: options.auditStore,
    ownerUserId: options.agent.ownerUserId,
    agentId: options.agent.agentId,
    ...(options.now ? { now: options.now } : {}),
  });
}

/** Private operator copy explaining Paused when status is capped. */
export function privatePausedReason(agent: OwnedAgent): string | null {
  switch (agent.status) {
    case "disabled":
      return "This agent is independently disabled. Re-enable it in Agent Settings or with conviction-mcp enable.";
    case "capped":
      return "Spend budget is exhausted (remaining $0). Increase the budget to restore Active unless the agent is also disabled.";
    case "provisioning":
      return "This agent is still provisioning and is shown as Paused publicly.";
    case "retiring":
      return "Retirement is in progress. Normal writes stay blocked.";
    case "retired":
      return "This agent is permanently retired.";
    case "active":
      return null;
    default: {
      const _exhaustive: never = agent.status;
      return _exhaustive;
    }
  }
}
