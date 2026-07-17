import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isAddress } from "ethers";
import { z } from "zod";

export const PROVISIONING_HANDOFF_TTL_MS = 10 * 60 * 1000;

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
  createdAt: string;
};

/** Fresh create path: reserved identity with no bound signer yet. */
export type PendingAgent = OwnedAgent & {
  address: null;
  status: "provisioning";
  publicStatus: "paused";
  lifetimeSpendUsd: 0;
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
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
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
};

export type AgentProvisioningRecord = {
  agent: OwnedAgent;
  handoff: StoredHandoff;
};

export type AgentProvisioningStore = {
  create(record: AgentProvisioningRecord): Promise<void>;
  findNonRetiredByOwner(ownerUserId: string): Promise<OwnedAgent | null>;
};

export type ProvisioningErrorCode =
  | "agent_exists"
  | "handle_unavailable"
  | "identity_unavailable"
  | "profile_missing"
  | "invalid_request";

export class AgentProvisioningError extends Error {
  constructor(
    public readonly code: ProvisioningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentProvisioningError";
  }
}

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
    createdAt: now.toISOString(),
  };

  await store.create({
    agent,
    handoff: {
      handoffId: randomId(),
      agentId: agent.agentId,
      codeHash: createHash("sha256").update(code).digest("hex"),
      expiresAt,
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

export class MemoryAgentProvisioningStore implements AgentProvisioningStore {
  readonly records: AgentProvisioningRecord[] = [];
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
}
