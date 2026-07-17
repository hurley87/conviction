import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, isAddress, verifyMessage } from "ethers";
import { z } from "zod";
import { AgentLeaseError, leaseConflictError } from "@/lib/agent-lease";

export const PROVISIONING_HANDOFF_TTL_MS = 10 * 60 * 1000;

export const PROVISIONING_PROOF_PREFIX = "Conviction MCP provisioning";
export const BACKUP_VERIFIED_PROOF_PREFIX = "Conviction MCP backup verified";

export const createAgentSchema = z
  .object({
    handle: z
      .string()
      .trim()
      .transform((value) => value.replace(/^@/, "").toLowerCase())
      .pipe(
        z
          .string()
          .min(3, "Use at least 3 characters for the agent handle.")
          .max(30, "Use no more than 30 characters for the agent handle.")
          .regex(
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
            "Use letters, numbers, and single hyphens; start and end with a letter or number.",
          ),
      ),
    returnAddress: z
      .string()
      .trim()
      .refine(isAddress, "Enter a valid EVM return address."),
    maxTradeUsd: z.coerce
      .number()
      .finite()
      .positive("The per-trade limit must be greater than zero.")
      .max(10_000, "The v1 per-trade limit cannot exceed $10,000."),
    spendBudgetUsd: z.coerce
      .number()
      .finite()
      .positive("The spend budget must be greater than zero.")
      .max(100_000, "The v1 spend budget cannot exceed $100,000."),
    actionPolicy: z.object({
      trade: z.boolean(),
      back: z.boolean(),
      publish: z.boolean(),
    }),
  })
  .refine((input) => input.spendBudgetUsd >= input.maxTradeUsd, {
    path: ["spendBudgetUsd"],
    message: "The spend budget must cover at least one maximum-size trade.",
  });

export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const AGENT_STATUSES = [
  "provisioning",
  "active",
  "disabled",
  "capped",
  "retiring",
  "retired",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_PUBLIC_STATUSES = ["active", "paused", "retired"] as const;

export type AgentPublicStatus = (typeof AGENT_PUBLIC_STATUSES)[number];

export type OwnedAgent = {
  agentId: string;
  ownerUserId: string;
  handle: string;
  authorKind: "agent";
  operatorHandle: string;
  address: string | null;
  returnAddress: string;
  status: AgentStatus;
  publicStatus: AgentPublicStatus;
  actionPolicy: CreateAgentInput["actionPolicy"];
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  /** True only after local backup export + decrypt-verification succeed. */
  fundingReady: boolean;
  createdAt: string;
};

/** Fresh create path: reserved identity with no bound signer yet. */
export type PendingAgent = OwnedAgent & {
  address: null;
  status: "provisioning";
  publicStatus: "paused";
  lifetimeSpendUsd: 0;
  fundingReady: false;
};

function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

function isAgentPublicStatus(value: string): value is AgentPublicStatus {
  return (AGENT_PUBLIC_STATUSES as readonly string[]).includes(value);
}

function isActionPolicy(
  value: unknown,
): value is CreateAgentInput["actionPolicy"] {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (
    typeof policy.trade === "boolean" &&
    typeof policy.back === "boolean" &&
    typeof policy.publish === "boolean"
  );
}

/** Map a persisted agents row into the API shape without inventing lifecycle fields. */
export function ownedAgentFromRow(row: Record<string, unknown>): OwnedAgent {
  const status = String(row.status ?? "");
  if (!isAgentStatus(status)) {
    throw new Error(`Unexpected agent status: ${status}`);
  }

  const publicStatus = String(row.public_status ?? "");
  if (!isAgentPublicStatus(publicStatus)) {
    throw new Error(`Unexpected agent public status: ${publicStatus}`);
  }

  if (!isActionPolicy(row.action_policy)) {
    throw new Error("Unexpected agent action policy.");
  }

  const addressValue = row.address;
  const address =
    addressValue === null || addressValue === undefined
      ? null
      : String(addressValue);

  const fundingReadyRaw = row.funding_ready;
  const fundingReady =
    fundingReadyRaw === true ||
    fundingReadyRaw === "true" ||
    fundingReadyRaw === "t" ||
    fundingReadyRaw === 1;

  return {
    agentId: String(row.agent_id),
    ownerUserId: String(row.owner_user_id),
    handle: String(row.handle),
    authorKind: "agent",
    operatorHandle: String(row.operator_handle),
    address,
    returnAddress: String(row.return_address),
    status,
    publicStatus,
    actionPolicy: row.action_policy,
    maxTradeUsd: Number(row.max_trade_usd),
    spendBudgetUsd: Number(row.spend_budget_usd),
    lifetimeSpendUsd: Number(row.lifetime_spend_usd),
    fundingReady,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

/** SHA-256 hex digest of a one-time provisioning code. */
export function hashProvisioningCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Canonical message the local signer must sign to prove possession. */
export function buildProvisioningProofMessage(
  codeHash: string,
  signerAddress: string,
): string {
  return [
    PROVISIONING_PROOF_PREFIX,
    "v1",
    `code:${codeHash}`,
    `signer:${getAddress(signerAddress)}`,
  ].join("\n");
}

/** Canonical message proving backup verification for a bound agent. */
export function buildBackupVerifiedMessage(
  agentId: string,
  signerAddress: string,
): string {
  return [
    BACKUP_VERIFIED_PROOF_PREFIX,
    "v1",
    `agent:${agentId}`,
    `signer:${getAddress(signerAddress)}`,
  ].join("\n");
}

export function verifyEoaSignature(
  message: string,
  signature: string,
  expectedAddress: string,
): boolean {
  try {
    const recovered = verifyMessage(message, signature);
    return getAddress(recovered) === getAddress(expectedAddress);
  } catch {
    return false;
  }
}

export type ProvisioningHandoff = {
  code: string;
  expiresAt: string;
  command: string;
};

export type CreateAgentResult = {
  agent: PendingAgent;
  handoff: ProvisioningHandoff;
};

export type StoredHandoff = {
  handoffId: string;
  agentId: string;
  codeHash: string;
  expiresAt: string;
  redeemedAt: string | null;
};

export type AgentProvisioningRecord = {
  agent: OwnedAgent;
  handoff: StoredHandoff;
};

export type HandoffLookup = {
  handoff: StoredHandoff;
  agent: OwnedAgent;
};

export type StoredAgentLease = {
  leaseId: string;
  agentId: string;
  expiresAt: string;
};

export type AgentProvisioningStore = {
  create(record: AgentProvisioningRecord): Promise<void>;
  findNonRetiredByOwner(ownerUserId: string): Promise<OwnedAgent | null>;
  findBySignerAddress(signerAddress: string): Promise<OwnedAgent | null>;
  findHandoffByCodeHash(codeHash: string): Promise<HandoffLookup | null>;
  redeemHandoff(input: {
    codeHash: string;
    signerAddress: string;
    now: Date;
  }): Promise<OwnedAgent>;
  markFundingReady(input: {
    agentId: string;
    signerAddress: string;
  }): Promise<OwnedAgent>;
  getActiveLease(agentId: string, now: Date): Promise<StoredAgentLease | null>;
  acquireLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
    replace?: boolean;
  }): Promise<StoredAgentLease>;
  renewLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
  }): Promise<StoredAgentLease>;
  releaseLease(input: { agentId: string; leaseId: string }): Promise<void>;
};

export type ProvisioningErrorCode =
  | "agent_exists"
  | "handle_unavailable"
  | "identity_unavailable"
  | "profile_missing"
  | "invalid_request"
  | "handoff_not_found"
  | "handoff_expired"
  | "handoff_used"
  | "invalid_proof"
  | "agent_not_pending"
  | "address_mismatch"
  | "agent_not_found";

export class AgentProvisioningError extends Error {
  constructor(
    public readonly code: ProvisioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentProvisioningError";
  }
}

export const redeemAgentSchema = z.object({
  code: z.string().trim().min(8, "Provide the full one-time provisioning code."),
  signerAddress: z
    .string()
    .trim()
    .refine(isAddress, "signerAddress must be a valid EVM address."),
  proofSignature: z
    .string()
    .trim()
    .min(80, "proofSignature must be a valid EOA signature."),
});

export type RedeemAgentInput = z.infer<typeof redeemAgentSchema>;

export const completeBackupSchema = z.object({
  agentId: z.string().uuid("agentId must be a UUID."),
  signerAddress: z
    .string()
    .trim()
    .refine(isAddress, "signerAddress must be a valid EVM address."),
  proofSignature: z
    .string()
    .trim()
    .min(80, "proofSignature must be a valid EOA signature."),
});

export type CompleteBackupInput = z.infer<typeof completeBackupSchema>;

export type ProvisioningOwner = {
  userId: string;
  operatorHandle: string;
};

type ProvisioningDependencies = {
  now?: () => Date;
  randomId?: () => string;
  randomCode?: () => string;
};

export async function createPendingAgent(
  store: AgentProvisioningStore,
  owner: ProvisioningOwner,
  untrustedInput: unknown,
  dependencies: ProvisioningDependencies = {},
): Promise<CreateAgentResult> {
  const parsed = createAgentSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    throw new AgentProvisioningError(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Check the agent details and try again.",
    );
  }

  const now = dependencies.now?.() ?? new Date();
  const randomId = dependencies.randomId ?? randomUUID;
  const code =
    dependencies.randomCode?.() ?? randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    now.getTime() + PROVISIONING_HANDOFF_TTL_MS,
  ).toISOString();

  const agent: PendingAgent = {
    agentId: randomId(),
    ownerUserId: owner.userId,
    handle: parsed.data.handle,
    authorKind: "agent",
    operatorHandle: owner.operatorHandle,
    address: null,
    returnAddress: parsed.data.returnAddress,
    status: "provisioning",
    publicStatus: "paused",
    actionPolicy: parsed.data.actionPolicy,
    maxTradeUsd: parsed.data.maxTradeUsd,
    spendBudgetUsd: parsed.data.spendBudgetUsd,
    lifetimeSpendUsd: 0,
    fundingReady: false,
    createdAt: now.toISOString(),
  };

  await store.create({
    agent,
    handoff: {
      handoffId: randomId(),
      agentId: agent.agentId,
      codeHash: hashProvisioningCode(code),
      expiresAt,
      redeemedAt: null,
    },
  });

  return {
    agent,
    handoff: {
      code,
      expiresAt,
      command: `conviction-mcp init --code ${code}`,
    },
  };
}

/**
 * Redeem a one-time handoff by binding a locally generated signer address.
 * Activates the agent but leaves fundingReady false until backup verification.
 */
export async function redeemPendingAgent(
  store: AgentProvisioningStore,
  untrustedInput: unknown,
  dependencies: { now?: () => Date } = {},
): Promise<OwnedAgent> {
  const parsed = redeemAgentSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    throw new AgentProvisioningError(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Check the redeem payload and try again.",
    );
  }

  const codeHash = hashProvisioningCode(parsed.data.code);
  const signerAddress = getAddress(parsed.data.signerAddress);
  const proofMessage = buildProvisioningProofMessage(codeHash, signerAddress);
  if (
    !verifyEoaSignature(
      proofMessage,
      parsed.data.proofSignature,
      signerAddress,
    )
  ) {
    throw new AgentProvisioningError(
      "invalid_proof",
      "The proof-of-possession signature does not match the signer address.",
    );
  }

  const now = dependencies.now?.() ?? new Date();
  return store.redeemHandoff({ codeHash, signerAddress, now });
}

/**
 * Mark backup verification complete so the agent becomes funding-eligible.
 */
export async function completeAgentBackupVerification(
  store: AgentProvisioningStore,
  untrustedInput: unknown,
): Promise<OwnedAgent> {
  const parsed = completeBackupSchema.safeParse(untrustedInput);
  if (!parsed.success) {
    throw new AgentProvisioningError(
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Check the backup verification payload.",
    );
  }

  const signerAddress = getAddress(parsed.data.signerAddress);
  const proofMessage = buildBackupVerifiedMessage(
    parsed.data.agentId,
    signerAddress,
  );
  if (
    !verifyEoaSignature(
      proofMessage,
      parsed.data.proofSignature,
      signerAddress,
    )
  ) {
    throw new AgentProvisioningError(
      "invalid_proof",
      "The backup-verification signature does not match the bound signer.",
    );
  }

  return store.markFundingReady({
    agentId: parsed.data.agentId,
    signerAddress,
  });
}

export class MemoryAgentProvisioningStore implements AgentProvisioningStore {
  readonly records: AgentProvisioningRecord[] = [];
  /** Active leases keyed by agentId. */
  readonly leases = new Map<string, StoredAgentLease>();
  private readonly humanHandles: Set<string>;

  constructor(humanHandles = new Set<string>()) {
    this.humanHandles = new Set(
      [...humanHandles].map((handle) => handle.toLowerCase()),
    );
  }

  async create(record: AgentProvisioningRecord): Promise<void> {
    if (
      this.records.some(
        ({ agent }) =>
          agent.ownerUserId === record.agent.ownerUserId &&
          agent.status !== "retired",
      )
    ) {
      throw new AgentProvisioningError(
        "agent_exists",
        "This account already has a v1 agent. Retire it before creating another.",
      );
    }
    if (
      this.humanHandles.has(record.agent.handle.toLowerCase()) ||
      this.records.some(
        ({ agent }) =>
          agent.handle.toLowerCase() === record.agent.handle.toLowerCase(),
      )
    ) {
      throw new AgentProvisioningError(
        "handle_unavailable",
        "That handle is already in use. Choose a different agent handle.",
      );
    }
    if (
      this.records.some(
        ({ agent }) => agent.agentId === record.agent.agentId,
      )
    ) {
      throw new AgentProvisioningError(
        "identity_unavailable",
        "We could not reserve an agent identity. Try creating the agent again.",
      );
    }
    this.records.push(record);
  }

  async findNonRetiredByOwner(
    ownerUserId: string,
  ): Promise<OwnedAgent | null> {
    return (
      this.records.find(
        ({ agent }) =>
          agent.ownerUserId === ownerUserId && agent.status !== "retired",
      )?.agent ?? null
    );
  }

  async findBySignerAddress(signerAddress: string): Promise<OwnedAgent | null> {
    const normalized = getAddress(signerAddress);
    return (
      this.records.find(
        ({ agent }) =>
          agent.address !== null && getAddress(agent.address) === normalized,
      )?.agent ?? null
    );
  }

  async findHandoffByCodeHash(codeHash: string): Promise<HandoffLookup | null> {
    const record = this.records.find(
      ({ handoff }) => handoff.codeHash === codeHash,
    );
    return record
      ? { handoff: record.handoff, agent: record.agent }
      : null;
  }

  async redeemHandoff(input: {
    codeHash: string;
    signerAddress: string;
    now: Date;
  }): Promise<OwnedAgent> {
    const lookup = await this.findHandoffByCodeHash(input.codeHash);
    if (!lookup) {
      throw new AgentProvisioningError(
        "handoff_not_found",
        "That provisioning code was not found. Create a new agent handoff in Agent Access.",
      );
    }

    const { handoff, agent } = lookup;
    const normalized = getAddress(input.signerAddress);

    // Already bound to this signer: succeed even if redeemed_at lagged.
    if (
      agent.address &&
      getAddress(agent.address) === normalized &&
      agent.status !== "provisioning"
    ) {
      if (!handoff.redeemedAt) {
        handoff.redeemedAt = input.now.toISOString();
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

    agent.address = normalized;
    agent.status = "active";
    agent.publicStatus = "active";
    agent.fundingReady = false;
    handoff.redeemedAt = input.now.toISOString();
    return agent;
  }

  async markFundingReady(input: {
    agentId: string;
    signerAddress: string;
  }): Promise<OwnedAgent> {
    const record = this.records.find(
      ({ agent }) => agent.agentId === input.agentId,
    );
    if (!record) {
      throw new AgentProvisioningError(
        "agent_not_found",
        "No agent matches that identity.",
      );
    }

    const { agent } = record;
    if (!agent.address) {
      throw new AgentProvisioningError(
        "agent_not_pending",
        "Redeem a provisioning handoff before verifying the signer backup.",
      );
    }

    if (getAddress(agent.address) !== getAddress(input.signerAddress)) {
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

    agent.fundingReady = true;
    return agent;
  }

  async getActiveLease(
    agentId: string,
    now: Date,
  ): Promise<StoredAgentLease | null> {
    const lease = this.leases.get(agentId);
    if (!lease) return null;
    if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
      this.leases.delete(agentId);
      return null;
    }
    return lease;
  }

  async acquireLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
    replace?: boolean;
  }): Promise<StoredAgentLease> {
    const exists = this.records.some(
      ({ agent }) => agent.agentId === input.agentId,
    );
    if (!exists) {
      throw new AgentLeaseError(
        "agent_not_found",
        "No agent matches that identity.",
      );
    }

    const active = await this.getActiveLease(input.agentId, input.now);
    if (active && active.leaseId !== input.leaseId && !input.replace) {
      throw leaseConflictError(active, input.now);
    }

    const lease: StoredAgentLease = {
      leaseId: input.leaseId,
      agentId: input.agentId,
      expiresAt: input.expiresAt,
    };
    this.leases.set(input.agentId, lease);
    return lease;
  }

  async renewLease(input: {
    agentId: string;
    leaseId: string;
    expiresAt: string;
    now: Date;
  }): Promise<StoredAgentLease> {
    const active = await this.getActiveLease(input.agentId, input.now);
    if (!active) {
      throw new AgentLeaseError(
        "lease_expired",
        "The MCP lease expired. Restart the server to acquire a new lease.",
      );
    }
    if (active.leaseId !== input.leaseId) {
      throw new AgentLeaseError(
        "lease_conflict",
        "This MCP lease was replaced by another process.",
        {
          activeLeaseId: active.leaseId,
          activeLeaseExpiresAt: active.expiresAt,
        },
      );
    }
    const lease: StoredAgentLease = {
      leaseId: input.leaseId,
      agentId: input.agentId,
      expiresAt: input.expiresAt,
    };
    this.leases.set(input.agentId, lease);
    return lease;
  }

  async releaseLease(input: {
    agentId: string;
    leaseId: string;
  }): Promise<void> {
    const current = this.leases.get(input.agentId);
    if (current && current.leaseId === input.leaseId) {
      this.leases.delete(input.agentId);
    }
  }
}
