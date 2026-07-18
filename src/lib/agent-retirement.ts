// Operator-authenticated retirement + canonical-cash recovery (issue #60 / ADR 0035 / 0021).
// Dedicated path: not MCP permits, not spend budget, destination locked to returnAddress.

import { randomUUID } from "node:crypto";
import { getAddress, isAddress } from "ethers";

import {
  buildAuditEvent,
  type AgentAuditStore,
} from "@/lib/agent-audit";
import {
  releaseIssuedPermits,
  type PermitInvalidator,
} from "@/lib/agent-policy";
import {
  AgentProvisioningError,
  type AgentProvisioningStore,
  type OwnedAgent,
} from "@/lib/agent-provisioning";
import { isTradeFundingAsset, assetMatches } from "@/lib/verbs/assets";
import { DEFAULT_DEST_CHAIN } from "@/lib/verbs/intent";
import type { UAClient } from "@/lib/ua/types";
import type { RawTransaction } from "@/lib/ua/trade";
import { userOpsNeeding7702 } from "@/lib/ua/trade";
import { hasParticleEnv } from "@/lib/ua";
import { validateWithdrawal } from "@/lib/verbs/withdrawal";
import type {
  BalanceSource,
  ProductAsset,
  TradeQuote,
  TradeSigners,
  UniversalBalance,
  WithdrawalQuote,
} from "@/lib/verbs/types";

/** Aggregate residual USD that may complete as dust without blocking retirement. */
export const RETIREMENT_DUST_THRESHOLD_USD = 1;

/** Recovery claim TTL — prevents stuck locks from blocking operator retry forever. */
export const RECOVERY_CLAIM_TTL_MS = 120_000;

export type RetirementReconciliationState =
  | "complete"
  | "pending_sync"
  | "needs_attention";

export type RetirementLegStatus =
  | "pending"
  | "quoted"
  | "in_flight"
  | "complete"
  | "failed"
  | "skipped";

/** Signable payload returned to the CLI for rootHash / EIP-7702 signing. */
export type RetirementSignableLeg = {
  legId: string;
  kind: "conversion" | "transfer";
  rootHash: string;
  userOpsNeeding7702: Array<{
    userOpHash: string;
    auth: { contractAddress: string; chainId: number; nonce: number };
  }>;
};

export type RetirementConversionLeg = {
  legId: string;
  kind: "conversion";
  fromAsset: ProductAsset;
  fromChain: string;
  sizeUsd: number;
  status: RetirementLegStatus;
  /** Stored quote for prepare → sign → submit (live Particle path). */
  quote: TradeQuote | null;
  rootHash: string | null;
  transactionId: string | null;
  receiptId: string | null;
  error: string | null;
};

export type RetirementTransferLeg = {
  legId: string;
  kind: "transfer";
  asset: "usdc";
  destChain: "Arbitrum";
  amount: string | null;
  destination: string;
  status: RetirementLegStatus;
  quote: WithdrawalQuote | null;
  rootHash: string | null;
  transactionId: string | null;
  receiptId: string | null;
  error: string | null;
};

export type RetirementResidualHolding = {
  asset: string;
  chain: string;
  usd: number;
  reason: string;
  unrecoverableDust: boolean;
};

export type AgentRetirementRecord = {
  retirementId: string;
  agentId: string;
  ownerUserId: string;
  returnAddress: string;
  idempotencyKey: string;
  reconciliationState: RetirementReconciliationState;
  conversionLegs: RetirementConversionLeg[];
  transferLeg: RetirementTransferLeg | null;
  residualHoldings: RetirementResidualHolding[];
  recoveredUsd: number;
  dustUsd: number;
  attemptCount: number;
  workflowRunId: string | null;
  lastError: string | null;
  /** Exclusive recovery claim — prevents concurrent convert/transfer races. */
  recoveryClaimToken: string | null;
  recoveryClaimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AgentRetirementStore = {
  save(record: AgentRetirementRecord): Promise<AgentRetirementRecord>;
  get(retirementId: string): Promise<AgentRetirementRecord | null>;
  getByAgentId(agentId: string): Promise<AgentRetirementRecord | null>;
  getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentRetirementRecord | null>;
  update(record: AgentRetirementRecord): Promise<AgentRetirementRecord>;
  casReconciliationState(input: {
    retirementId: string;
    from: RetirementReconciliationState;
    to: RetirementReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentRetirementRecord | null>;
  setWorkflowRunId(
    retirementId: string,
    workflowRunId: string,
  ): Promise<void>;
  /**
   * Claim exclusive recovery. Succeeds when unlocked, expired, or same token.
   * Returns the claimed record or null when another claim is active.
   */
  claimRecovery(input: {
    retirementId: string;
    claimToken: string;
    now: Date;
    ttlMs?: number;
  }): Promise<AgentRetirementRecord | null>;
  releaseRecovery(input: {
    retirementId: string;
    claimToken: string;
  }): Promise<AgentRetirementRecord | null>;
};

export type RetirementWorkflowStarter = {
  start(retirementId: string): Promise<{ runId: string }>;
};

export type StartRetirementResult = {
  agent: OwnedAgent;
  retirement: AgentRetirementRecord;
  releasedPermitCount: number;
  /** True when recovery still needs the original local signer. */
  recoveryRequired: boolean;
};

export type RetirementRecoveryResult = {
  agent: OwnedAgent;
  retirement: AgentRetirementRecord;
};

const FUNDING_PRODUCT_ASSETS: ProductAsset[] = [
  "usdc",
  "usdt",
  "eth",
  "sol",
];

function cloneRecord(record: AgentRetirementRecord): AgentRetirementRecord {
  return structuredClone(record);
}

/** In-memory retirement store for tests and offline mock paths. */
export class MemoryAgentRetirementStore implements AgentRetirementStore {
  private readonly records = new Map<string, AgentRetirementRecord>();
  private readonly byAgent = new Map<string, string>();
  private readonly byIdempotency = new Map<string, string>();

  private idemKey(agentId: string, idempotencyKey: string): string {
    return `${agentId}\0${idempotencyKey}`;
  }

  async save(record: AgentRetirementRecord): Promise<AgentRetirementRecord> {
    const existingByAgent = this.byAgent.get(record.agentId);
    if (existingByAgent) {
      const existing = this.records.get(existingByAgent);
      if (existing) return cloneRecord(existing);
    }
    const existingByIdem = this.byIdempotency.get(
      this.idemKey(record.agentId, record.idempotencyKey),
    );
    if (existingByIdem) {
      const existing = this.records.get(existingByIdem);
      if (existing) return cloneRecord(existing);
    }
    this.records.set(record.retirementId, cloneRecord(record));
    this.byAgent.set(record.agentId, record.retirementId);
    this.byIdempotency.set(
      this.idemKey(record.agentId, record.idempotencyKey),
      record.retirementId,
    );
    return cloneRecord(record);
  }

  async get(retirementId: string): Promise<AgentRetirementRecord | null> {
    const record = this.records.get(retirementId);
    return record ? cloneRecord(record) : null;
  }

  async getByAgentId(agentId: string): Promise<AgentRetirementRecord | null> {
    const id = this.byAgent.get(agentId);
    if (!id) return null;
    return this.get(id);
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentRetirementRecord | null> {
    const id = this.byIdempotency.get(this.idemKey(agentId, idempotencyKey));
    if (!id) return null;
    return this.get(id);
  }

  async update(record: AgentRetirementRecord): Promise<AgentRetirementRecord> {
    if (!this.records.has(record.retirementId)) {
      throw new Error(`Unknown retirement ${record.retirementId}`);
    }
    const next = cloneRecord(record);
    this.records.set(record.retirementId, next);
    this.byAgent.set(record.agentId, record.retirementId);
    return cloneRecord(next);
  }

  async casReconciliationState(input: {
    retirementId: string;
    from: RetirementReconciliationState;
    to: RetirementReconciliationState;
    workflowRunId?: string | null;
    lastError?: string | null;
    completedAt?: string | null;
    attemptCount?: number;
  }): Promise<AgentRetirementRecord | null> {
    const current = this.records.get(input.retirementId);
    if (!current || current.reconciliationState !== input.from) return null;
    const next: AgentRetirementRecord = {
      ...current,
      reconciliationState: input.to,
      updatedAt: new Date().toISOString(),
      ...(input.workflowRunId !== undefined
        ? { workflowRunId: input.workflowRunId }
        : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.completedAt !== undefined
        ? { completedAt: input.completedAt }
        : {}),
      ...(input.attemptCount !== undefined
        ? { attemptCount: input.attemptCount }
        : {}),
    };
    this.records.set(input.retirementId, next);
    return cloneRecord(next);
  }

  async setWorkflowRunId(
    retirementId: string,
    workflowRunId: string,
  ): Promise<void> {
    const current = this.records.get(retirementId);
    if (!current) return;
    this.records.set(retirementId, {
      ...current,
      workflowRunId,
      updatedAt: new Date().toISOString(),
    });
  }

  async claimRecovery(input: {
    retirementId: string;
    claimToken: string;
    now: Date;
    ttlMs?: number;
  }): Promise<AgentRetirementRecord | null> {
    const current = this.records.get(input.retirementId);
    if (!current) return null;
    const ttl = input.ttlMs ?? RECOVERY_CLAIM_TTL_MS;
    const claimedAtMs = current.recoveryClaimedAt
      ? new Date(current.recoveryClaimedAt).getTime()
      : 0;
    const expired =
      !current.recoveryClaimToken ||
      claimedAtMs + ttl <= input.now.getTime();
    const sameToken = current.recoveryClaimToken === input.claimToken;
    if (!expired && !sameToken) return null;
    const next: AgentRetirementRecord = {
      ...current,
      recoveryClaimToken: input.claimToken,
      recoveryClaimedAt: input.now.toISOString(),
      updatedAt: input.now.toISOString(),
    };
    this.records.set(input.retirementId, next);
    return cloneRecord(next);
  }

  async releaseRecovery(input: {
    retirementId: string;
    claimToken: string;
  }): Promise<AgentRetirementRecord | null> {
    const current = this.records.get(input.retirementId);
    if (!current || current.recoveryClaimToken !== input.claimToken) {
      return current ? cloneRecord(current) : null;
    }
    const next: AgentRetirementRecord = {
      ...current,
      recoveryClaimToken: null,
      recoveryClaimedAt: null,
      updatedAt: new Date().toISOString(),
    };
    this.records.set(input.retirementId, next);
    return cloneRecord(next);
  }

  clear(): void {
    this.records.clear();
    this.byAgent.clear();
    this.byIdempotency.clear();
  }
}

/** True only for explicit test/local mock recovery — never production. */
export function canUseMockRetirementRecovery(options?: {
  allowMock?: boolean;
}): boolean {
  if (options?.allowMock === true) return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.CONVICTION_WORKFLOW_WORLD === "local") return true;
  if (process.env.CONVICTION_ALLOW_MOCK_UA === "true") return true;
  return false;
}

function emptyConversionLeg(
  fromAsset: ProductAsset,
  fromChain: string,
  sizeUsd: number,
): RetirementConversionLeg {
  return {
    legId: conversionLegId(fromAsset, fromChain),
    kind: "conversion",
    fromAsset,
    fromChain,
    sizeUsd,
    status: "pending",
    quote: null,
    rootHash: null,
    transactionId: null,
    receiptId: null,
    error: null,
  };
}

function emptyTransferLeg(
  destination: string,
  amount: string,
): RetirementTransferLeg {
  return {
    legId: transferLegId(destination),
    kind: "transfer",
    asset: "usdc",
    destChain: "Arbitrum",
    amount,
    destination,
    status: "pending",
    quote: null,
    rootHash: null,
    transactionId: null,
    receiptId: null,
    error: null,
  };
}

function isTerminalLegStatus(status: RetirementLegStatus): boolean {
  return status === "complete" || status === "skipped";
}

function assertTransferDestinationLocked(
  quoteDestination: string,
  returnAddress: string,
): void {
  if (getAddress(quoteDestination) !== getAddress(returnAddress)) {
    throw new Error(
      "Withdrawal quote destination must equal the locked return address.",
    );
  }
}

function validateRetirementWithdrawal(input: {
  amount: string;
  destination: string;
  ownerAddress: string | null | undefined;
  balance: UniversalBalance;
}): void {
  const validated = validateWithdrawal({
    asset: "usdc",
    destChain: "Arbitrum",
    amountRaw: input.amount,
    destinationRaw: input.destination,
    ownerAddress: input.ownerAddress,
    balance: input.balance,
  });
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  if (getAddress(validated.request.destination) !== getAddress(input.destination)) {
    throw new Error(
      "Validated withdrawal destination must equal the locked return address.",
    );
  }
}

export function assertRetirementOwnership(
  retirement: AgentRetirementRecord,
  agent: OwnedAgent,
): void {
  if (
    retirement.agentId !== agent.agentId ||
    retirement.ownerUserId !== agent.ownerUserId
  ) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record matches that agent.",
    );
  }
}

function rawFromUnknown(raw: unknown): RawTransaction | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as RawTransaction;
}

function rootHashFromQuote(
  quote: TradeQuote | WithdrawalQuote | null | undefined,
): string | null {
  if (!quote) return null;
  const raw = rawFromUnknown(quote.rawTransaction);
  return typeof raw?.rootHash === "string" ? raw.rootHash : null;
}

function signableFromLeg(
  leg: RetirementConversionLeg | RetirementTransferLeg,
): RetirementSignableLeg | null {
  if (leg.status !== "quoted" || !leg.rootHash) return null;
  const raw = rawFromQuote(leg.quote);
  return {
    legId: leg.legId,
    kind: leg.kind,
    rootHash: leg.rootHash,
    userOpsNeeding7702: userOpsNeeding7702(raw?.userOps).map((pending) => ({
      userOpHash: pending.userOpHash,
      auth: pending.auth,
    })),
  };
}

function rawFromQuote(
  quote: TradeQuote | WithdrawalQuote | null | undefined,
): RawTransaction | null {
  if (!quote) return null;
  return rawFromUnknown(quote.rawTransaction);
}

/** Build TradeSigners that return CLI-provided signatures (live Particle submit). */
export function createProvidedRetirementSigners(input: {
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
}): TradeSigners {
  let authCursor = 0;
  const authList = input.authorizations ?? [];
  return {
    async signRootHash() {
      if (!input.rootHashSignature.startsWith("0x")) {
        throw new Error("Invalid rootHash signature.");
      }
      return input.rootHashSignature;
    },
    async sign7702() {
      const next = authList[authCursor];
      authCursor += 1;
      if (next?.signature?.startsWith("0x")) return next.signature;
      throw new Error("Missing EIP-7702 authorization signature.");
    },
  };
}

function assertOwner(agent: OwnedAgent, ownerUserId: string): void {
  if (agent.ownerUserId !== ownerUserId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
}

function lockedReturnAddress(agent: OwnedAgent): string {
  if (!isAddress(agent.returnAddress)) {
    throw new AgentProvisioningError(
      "invalid_request",
      "The stored return address is not a valid EVM address.",
    );
  }
  return getAddress(agent.returnAddress);
}

/** Map a balance source symbol onto a trade-funding product asset when possible. */
export function productAssetForSource(
  source: BalanceSource,
): ProductAsset | null {
  for (const asset of FUNDING_PRODUCT_ASSETS) {
    if (assetMatches(source.asset, asset) && isTradeFundingAsset(asset)) {
      return asset;
    }
  }
  return null;
}

/**
 * Classify holdings: Arbitrum USDC is canonical cash; other funding assets need
 * conversion; everything else is residual until dust rules apply.
 */
export function classifyHoldings(balance: UniversalBalance): {
  canonicalUsdcUsd: number;
  conversions: Array<{
    fromAsset: ProductAsset;
    fromChain: string;
    sizeUsd: number;
  }>;
  residuals: RetirementResidualHolding[];
} {
  let canonicalUsdcUsd = 0;
  const conversions: Array<{
    fromAsset: ProductAsset;
    fromChain: string;
    sizeUsd: number;
  }> = [];
  const residuals: RetirementResidualHolding[] = [];

  for (const source of balance.sources) {
    if (!(source.usd > 0)) continue;
    const product = productAssetForSource(source);
    const isArbitrumUsdc =
      source.chain === "Arbitrum" &&
      assetMatches(source.asset, "usdc");

    if (isArbitrumUsdc) {
      canonicalUsdcUsd += source.usd;
      continue;
    }

    if (product) {
      conversions.push({
        fromAsset: product,
        fromChain: source.chain,
        sizeUsd: source.usd,
      });
      continue;
    }

    residuals.push({
      asset: source.asset,
      chain: source.chain,
      usd: source.usd,
      reason: "Unsupported or non-routable holding for retirement recovery.",
      unrecoverableDust: false,
    });
  }

  return { canonicalUsdcUsd, conversions, residuals };
}

function conversionLegId(fromAsset: ProductAsset, fromChain: string): string {
  return `convert:${fromAsset}:${fromChain}`;
}

function transferLegId(destination: string): string {
  return `transfer:usdc:Arbitrum:${destination.toLowerCase()}`;
}

async function appendAuditBestEffort(
  auditStore: AgentAuditStore,
  event: ReturnType<typeof buildAuditEvent>,
): Promise<void> {
  try {
    await auditStore.append(event);
  } catch (error) {
    console.error("Failed to append retirement audit event", {
      type: event.type,
      agentId: event.agentId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Start retirement: CAS agent to retiring, release write permits, persist a
 * durable retirement record. Idempotent for an already-retiring agent.
 */
export async function startRetirement(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    ownerUserId: string;
    agentId: string;
    idempotencyKey?: string;
    now?: Date;
    workflow?: RetirementWorkflowStarter;
  } & PermitInvalidator,
): Promise<StartRetirementResult> {
  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);

  if (agent.status === "retired") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is already retired.`,
    );
  }

  const existing = await options.retirementStore.getByAgentId(agent.agentId);
  if (agent.status === "retiring" && existing) {
    return {
      agent,
      retirement: existing,
      releasedPermitCount: 0,
      recoveryRequired: existing.reconciliationState !== "complete",
    };
  }

  const now = options.now ?? new Date();
  const returnAddress = lockedReturnAddress(agent);
  const idempotencyKey =
    options.idempotencyKey?.trim() ||
    `retire:${agent.agentId}:${now.toISOString()}`;

  const byIdem = await options.retirementStore.getByIdempotency(
    agent.agentId,
    idempotencyKey,
  );
  if (byIdem) {
    const current = await options.store.findNonRetiredByOwner(options.ownerUserId);
    return {
      agent: current ?? agent,
      retirement: byIdem,
      releasedPermitCount: 0,
      recoveryRequired: byIdem.reconciliationState !== "complete",
    };
  }

  const updated = await options.store.beginRetirement({
    agentId: agent.agentId,
    ownerUserId: options.ownerUserId,
    retirementStartedAt: now.toISOString(),
  });

  const releasedPermitCount = await releaseIssuedPermits({
    permitStore: options.permitStore,
    spendLedger: options.spendLedger,
    agentId: updated.agentId,
  });

  const retirement: AgentRetirementRecord = {
    retirementId: randomUUID(),
    agentId: updated.agentId,
    ownerUserId: updated.ownerUserId,
    returnAddress,
    idempotencyKey,
    reconciliationState: "pending_sync",
    conversionLegs: [],
    transferLeg: null,
    residualHoldings: [],
    recoveredUsd: 0,
    dustUsd: 0,
    attemptCount: 0,
    workflowRunId: null,
    lastError: null,
    recoveryClaimToken: null,
    recoveryClaimedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
  };

  const saved = await options.retirementStore.save(retirement);

  await appendAuditBestEffort(
    options.auditStore,
    buildAuditEvent({
      agentId: updated.agentId,
      ownerUserId: updated.ownerUserId,
      type: "retirement_started",
      actor: "operator",
      now,
      details: {
        retirementId: saved.retirementId,
        returnAddress,
        beforeStatus: agent.status,
        releasedPermitCount,
      },
    }),
  );

  // Durable residual reconciliation is started by callers after recovery legs
  // are attempted — never before signing-backed conversion/transfer (ADR 0029).
  if (options.workflow) {
    saved.workflowRunId = null;
  }

  return {
    agent: updated,
    retirement: saved,
    releasedPermitCount,
    recoveryRequired: true,
  };
}

/** Start residual reconciliation workflow after recovery legs are committed. */
export async function startRetirementReconciliationWorkflow(options: {
  retirementStore: AgentRetirementStore;
  retirementId: string;
  workflow: RetirementWorkflowStarter;
}): Promise<AgentRetirementRecord | null> {
  const retirement = await options.retirementStore.get(options.retirementId);
  if (!retirement || retirement.reconciliationState === "complete") {
    return retirement;
  }
  try {
    const { runId } = await options.workflow.start(options.retirementId);
    await options.retirementStore.setWorkflowRunId(
      options.retirementId,
      runId,
    );
    return {
      ...retirement,
      workflowRunId: runId,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not start retirement recovery workflow.";
    await options.retirementStore.casReconciliationState({
      retirementId: options.retirementId,
      from: retirement.reconciliationState,
      to: retirement.reconciliationState,
      lastError: message,
    });
    return {
      ...retirement,
      lastError: message,
    };
  }
}

export async function startRetirementBySigner(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    idempotencyKey?: string;
    now?: Date;
    workflow?: RetirementWorkflowStarter;
  } & PermitInvalidator,
): Promise<StartRetirementResult> {
  return startRetirement({
    store: options.store,
    retirementStore: options.retirementStore,
    auditStore: options.auditStore,
    permitStore: options.permitStore,
    spendLedger: options.spendLedger,
    ownerUserId: options.agent.ownerUserId,
    agentId: options.agent.agentId,
    ...(options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.workflow ? { workflow: options.workflow } : {}),
  });
}

function markResidualsDust(
  residuals: RetirementResidualHolding[],
): { residuals: RetirementResidualHolding[]; dustUsd: number } {
  const total = residuals.reduce((sum, item) => sum + item.usd, 0);
  if (total > 0 && total < RETIREMENT_DUST_THRESHOLD_USD) {
    return {
      residuals: residuals.map((item) => ({
        ...item,
        unrecoverableDust: true,
        reason:
          item.reason ||
          "Recorded as unrecoverable dust below the $1 retirement threshold.",
      })),
      dustUsd: total,
    };
  }
  return { residuals, dustUsd: 0 };
}

export type RetirementPrepareResult = RetirementRecoveryResult & {
  /** Next leg the CLI must sign, or null when only finalize remains. */
  signable: RetirementSignableLeg | null;
};

async function loadOwnedRetirement(options: {
  retirementStore: AgentRetirementStore;
  agent: OwnedAgent;
  retirementId: string;
}): Promise<AgentRetirementRecord> {
  const retirement = await options.retirementStore.get(options.retirementId);
  if (!retirement) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record matches that agent.",
    );
  }
  assertRetirementOwnership(retirement, options.agent);
  if (getAddress(retirement.returnAddress) !== getAddress(options.agent.returnAddress)) {
    throw new AgentProvisioningError(
      "invalid_request",
      "Return address is locked for this retirement and cannot change.",
    );
  }
  return retirement;
}

function buildResidualHoldings(
  classified: ReturnType<typeof classifyHoldings>,
): RetirementResidualHolding[] {
  const residualHoldings: RetirementResidualHolding[] = [
    ...classified.residuals,
  ];
  for (const item of classified.conversions) {
    residualHoldings.push({
      asset: item.fromAsset.toUpperCase(),
      chain: item.fromChain,
      usd: item.sizeUsd,
      reason: "Routable holding remained after recovery attempt.",
      unrecoverableDust: false,
    });
  }
  if (classified.canonicalUsdcUsd >= RETIREMENT_DUST_THRESHOLD_USD) {
    residualHoldings.push({
      asset: "USDC",
      chain: "Arbitrum",
      usd: classified.canonicalUsdcUsd,
      reason: "Canonical USDC remained after the return-address transfer.",
      unrecoverableDust: false,
    });
  } else if (classified.canonicalUsdcUsd > 0) {
    residualHoldings.push({
      asset: "USDC",
      chain: "Arbitrum",
      usd: classified.canonicalUsdcUsd,
      reason:
        "Recorded as unrecoverable dust below the $1 retirement threshold.",
      unrecoverableDust: true,
    });
  }
  return residualHoldings;
}

async function completeRetirementRecord(options: {
  store: AgentProvisioningStore;
  retirementStore: AgentRetirementStore;
  auditStore: AgentAuditStore;
  agent: OwnedAgent;
  retirement: AgentRetirementRecord;
  now: Date;
  actor: "operator" | "system";
  via?: string;
}): Promise<RetirementRecoveryResult> {
  const completedAgent = await options.store.completeRetirement({
    agentId: options.agent.agentId,
    ownerUserId: options.agent.ownerUserId,
    retiredAt: options.now.toISOString(),
  });
  const retirement = await options.retirementStore.update({
    ...options.retirement,
    reconciliationState: "complete",
    completedAt: options.now.toISOString(),
    lastError: null,
    recoveryClaimToken: null,
    recoveryClaimedAt: null,
    updatedAt: options.now.toISOString(),
  });
  await appendAuditBestEffort(
    options.auditStore,
    buildAuditEvent({
      agentId: completedAgent.agentId,
      ownerUserId: completedAgent.ownerUserId,
      type: "retirement_completed",
      actor: options.actor,
      now: options.now,
      details: {
        retirementId: retirement.retirementId,
        recoveredUsd: retirement.recoveredUsd,
        dustUsd: retirement.dustUsd,
        residualCount: retirement.residualHoldings.length,
        ...(options.via ? { via: options.via } : {}),
      },
    }),
  );
  return { agent: completedAgent, retirement };
}

/**
 * Idempotent mock/local recovery: convert → transfer → reconcile with
 * in-process TradeSigners. Production Particle must use prepare → submit.
 */
export async function executeRetirementRecovery(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    retirementId: string;
    ua: UAClient;
    signers: TradeSigners;
    allowMock?: boolean;
    now?: Date;
    randomId?: () => string;
  },
): Promise<RetirementRecoveryResult> {
  if (options.agent.status === "retired") {
    const existing = await options.retirementStore.get(options.retirementId);
    if (existing) {
      assertRetirementOwnership(existing, options.agent);
      return { agent: options.agent, retirement: existing };
    }
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${options.agent.handle} is already retired.`,
    );
  }
  if (options.agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${options.agent.handle} must be retiring before recovery runs.`,
    );
  }

  // Production Particle must use prepare → sign → submit. Explicit allowMock is
  // reserved for unit tests that inject MockUAClient + mockTradeSigners.
  if (hasParticleEnv() && options.allowMock !== true) {
    throw new AgentProvisioningError(
      "invalid_request",
      "Live Particle recovery requires prepare → sign → submit. In-process recovery is disabled.",
    );
  }
  if (!canUseMockRetirementRecovery({ allowMock: options.allowMock })) {
    throw new AgentProvisioningError(
      "setup_not_ready",
      "Retirement recovery is not configured for mock execution in this environment.",
    );
  }

  let retirement = await loadOwnedRetirement(options);
  if (retirement.reconciliationState === "complete") {
    return { agent: options.agent, retirement };
  }

  const now = options.now ?? new Date();
  const claimToken = options.randomId?.() ?? randomUUID();
  const claimed = await options.retirementStore.claimRecovery({
    retirementId: retirement.retirementId,
    claimToken,
    now,
  });
  if (!claimed) {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      "Retirement recovery is already in progress. Retry shortly.",
    );
  }
  retirement = claimed;

  try {
    await appendAuditBestEffort(
      options.auditStore,
      buildAuditEvent({
        agentId: options.agent.agentId,
        ownerUserId: options.agent.ownerUserId,
        type: "recovery_attempted",
        actor: "operator",
        now,
        details: {
          retirementId: retirement.retirementId,
          attemptCount: retirement.attemptCount + 1,
        },
      }),
    );

    retirement = await options.retirementStore.update({
      ...retirement,
      attemptCount: retirement.attemptCount + 1,
      updatedAt: now.toISOString(),
      lastError: null,
      reconciliationState: "pending_sync",
    });

    const returnAddress = retirement.returnAddress;
    let balance: UniversalBalance;
    try {
      balance = await options.ua.getUniversalBalance();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not read agent holdings for retirement recovery.";
      retirement = await options.retirementStore.update({
        ...retirement,
        reconciliationState: "needs_attention",
        lastError: message,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
        updatedAt: now.toISOString(),
      });
      return { agent: options.agent, retirement };
    }

    const classified = classifyHoldings(balance);
    const conversionById = new Map(
      retirement.conversionLegs.map((leg) => [leg.legId, leg]),
    );

    for (const item of classified.conversions) {
      const legId = conversionLegId(item.fromAsset, item.fromChain);
      const existing = conversionById.get(legId);
      if (existing && isTerminalLegStatus(existing.status)) continue;

      let leg: RetirementConversionLeg = existing
        ? {
            ...existing,
            sizeUsd: item.sizeUsd,
            // Interrupted in-flight legs are re-armed on operator retry.
            status:
              existing.status === "in_flight" ? "pending" : existing.status,
          }
        : emptyConversionLeg(item.fromAsset, item.fromChain, item.sizeUsd);

      leg = { ...leg, status: "in_flight", error: null };
      conversionById.set(legId, leg);
      retirement = await options.retirementStore.update({
        ...retirement,
        conversionLegs: [...conversionById.values()],
        updatedAt: now.toISOString(),
      });

      try {
        const intent = {
          fromAsset: item.fromAsset,
          toAsset: "cash" as const,
          sizeUsd: item.sizeUsd,
          destChain: DEFAULT_DEST_CHAIN,
        };
        const quote = await options.ua.quoteTrade({
          intent,
          sizeUsd: item.sizeUsd,
        });
        const receiptSlug =
          options.randomId?.() ??
          `retire_conv_${legId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
        const result = await options.ua.executeTrade({
          intent,
          sizeUsd: item.sizeUsd,
          agreedQuote: quote,
          signers: options.signers,
          receiptSlug,
        });
        leg = {
          ...leg,
          status: "complete",
          quote,
          rootHash: rootHashFromQuote(quote),
          transactionId: result.transactionId,
          receiptId: result.receipt.slug,
          error: null,
        };
      } catch (error) {
        leg = {
          ...leg,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Conversion failed during retirement recovery.",
        };
      }

      conversionById.set(legId, leg);
      // Persist before the next leg so crashes never re-run a completed convert.
      retirement = await options.retirementStore.update({
        ...retirement,
        conversionLegs: [...conversionById.values()],
        updatedAt: now.toISOString(),
      });

      if (leg.status === "failed") {
        retirement = await options.retirementStore.update({
          ...retirement,
          reconciliationState: "needs_attention",
          lastError: leg.error,
          recoveryClaimToken: null,
          recoveryClaimedAt: null,
          updatedAt: now.toISOString(),
        });
        return { agent: options.agent, retirement };
      }
    }

    retirement = {
      ...retirement,
      conversionLegs: [...conversionById.values()],
    };

    try {
      balance = await options.ua.getUniversalBalance();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not re-read holdings after conversion.";
      retirement = await options.retirementStore.update({
        ...retirement,
        reconciliationState: "needs_attention",
        lastError: message,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
        updatedAt: now.toISOString(),
      });
      return { agent: options.agent, retirement };
    }

    const afterConvert = classifyHoldings(balance);
    let recoveredUsd = retirement.recoveredUsd;

    if (afterConvert.canonicalUsdcUsd > 0) {
      const transferId = transferLegId(returnAddress);
      let transfer =
        retirement.transferLeg &&
        retirement.transferLeg.legId === transferId &&
        isTerminalLegStatus(retirement.transferLeg.status)
          ? retirement.transferLeg
          : emptyTransferLeg(
              returnAddress,
              afterConvert.canonicalUsdcUsd.toFixed(6),
            );

      if (!isTerminalLegStatus(transfer.status)) {
        transfer = {
          ...transfer,
          amount: afterConvert.canonicalUsdcUsd.toFixed(6),
          destination: returnAddress,
          status: "in_flight",
          error: null,
        };
        retirement = await options.retirementStore.update({
          ...retirement,
          transferLeg: transfer,
          updatedAt: now.toISOString(),
        });

        try {
          validateRetirementWithdrawal({
            amount: transfer.amount!,
            destination: returnAddress,
            ownerAddress: options.agent.address,
            balance,
          });
          const quote = await options.ua.quoteWithdrawal({
            request: {
              asset: "usdc",
              destChain: "Arbitrum",
              amount: transfer.amount!,
              destination: returnAddress,
            },
          });
          assertTransferDestinationLocked(quote.destination, returnAddress);
          const result = await options.ua.executeWithdrawal({
            agreedQuote: {
              ...quote,
              destination: returnAddress,
            },
            signers: options.signers,
          });
          transfer = {
            ...transfer,
            status: "complete",
            quote,
            rootHash: rootHashFromQuote(quote),
            transactionId: result.transactionId,
            receiptId: result.transactionId,
            amount: result.amount,
            error: null,
          };
          recoveredUsd += result.estimatedDebitUsd;
        } catch (error) {
          transfer = {
            ...transfer,
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Final USDC transfer failed during retirement recovery.",
          };
          retirement = await options.retirementStore.update({
            ...retirement,
            transferLeg: transfer,
            reconciliationState: "needs_attention",
            lastError: transfer.error,
            recoveryClaimToken: null,
            recoveryClaimedAt: null,
            updatedAt: now.toISOString(),
          });
          return { agent: options.agent, retirement };
        }

        retirement = await options.retirementStore.update({
          ...retirement,
          transferLeg: transfer,
          recoveredUsd,
          updatedAt: now.toISOString(),
        });
      } else if (transfer.status === "complete") {
        retirement = { ...retirement, transferLeg: transfer };
      }
    } else if (
      !retirement.transferLeg ||
      !isTerminalLegStatus(retirement.transferLeg.status)
    ) {
      retirement = await options.retirementStore.update({
        ...retirement,
        transferLeg: {
          ...emptyTransferLeg(returnAddress, "0"),
          status: "skipped",
        },
        updatedAt: now.toISOString(),
      });
    }

    try {
      balance = await options.ua.getUniversalBalance();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not reconcile residual holdings after transfer.";
      retirement = await options.retirementStore.update({
        ...retirement,
        recoveredUsd,
        reconciliationState: "needs_attention",
        lastError: message,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
        updatedAt: now.toISOString(),
      });
      return { agent: options.agent, retirement };
    }

    const residualHoldings = buildResidualHoldings(classifyHoldings(balance));
    const residualTotal = residualHoldings.reduce(
      (sum, item) => sum + item.usd,
      0,
    );
    const { residuals: dustMarked, dustUsd } =
      markResidualsDust(residualHoldings);

    retirement = {
      ...retirement,
      recoveredUsd,
      residualHoldings: dustMarked,
      dustUsd:
        dustUsd ||
        dustMarked
          .filter((item) => item.unrecoverableDust)
          .reduce((sum, item) => sum + item.usd, 0),
      updatedAt: now.toISOString(),
    };

    if (
      !retirement.transferLeg ||
      !isTerminalLegStatus(retirement.transferLeg.status)
    ) {
      retirement = await options.retirementStore.update({
        ...retirement,
        reconciliationState: "needs_attention",
        lastError:
          "Cannot complete retirement until the canonical USDC transfer leg is terminal.",
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
      });
      return { agent: options.agent, retirement };
    }

    if (residualTotal >= RETIREMENT_DUST_THRESHOLD_USD) {
      retirement = await options.retirementStore.update({
        ...retirement,
        reconciliationState: "needs_attention",
        lastError: `Recoverable residual value of $${residualTotal.toFixed(2)} remains (threshold $${RETIREMENT_DUST_THRESHOLD_USD.toFixed(2)}). Retry recovery with the original local signer.`,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
      });
      return { agent: options.agent, retirement };
    }

    return completeRetirementRecord({
      store: options.store,
      retirementStore: options.retirementStore,
      auditStore: options.auditStore,
      agent: options.agent,
      retirement,
      now,
      actor: "operator",
    });
  } catch (error) {
    await options.retirementStore.releaseRecovery({
      retirementId: retirement.retirementId,
      claimToken,
    });
    throw error;
  }
}

/**
 * Live Particle step 1: quote the next unfinished leg and return digests for
 * CLI signing. Persists the quote so submit uses the same rootHash.
 */
export async function prepareRetirementRecovery(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    retirementId: string;
    ua: UAClient;
    now?: Date;
    randomId?: () => string;
  },
): Promise<RetirementPrepareResult> {
  if (!hasParticleEnv()) {
    throw new AgentProvisioningError(
      "setup_not_ready",
      "Particle UA is not configured for live retirement recovery.",
    );
  }
  if (options.agent.status === "retired") {
    const existing = await loadOwnedRetirement(options);
    return { agent: options.agent, retirement: existing, signable: null };
  }
  if (options.agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${options.agent.handle} must be retiring before recovery runs.`,
    );
  }

  let retirement = await loadOwnedRetirement(options);
  if (retirement.reconciliationState === "complete") {
    return { agent: options.agent, retirement, signable: null };
  }

  const now = options.now ?? new Date();
  const claimToken = options.randomId?.() ?? randomUUID();
  const claimed = await options.retirementStore.claimRecovery({
    retirementId: retirement.retirementId,
    claimToken,
    now,
  });
  if (!claimed) {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      "Retirement recovery is already in progress. Retry shortly.",
    );
  }
  retirement = claimed;

  try {
    await appendAuditBestEffort(
      options.auditStore,
      buildAuditEvent({
        agentId: options.agent.agentId,
        ownerUserId: options.agent.ownerUserId,
        type: "recovery_attempted",
        actor: "operator",
        now,
        details: {
          retirementId: retirement.retirementId,
          attemptCount: retirement.attemptCount + 1,
          phase: "prepare",
        },
      }),
    );

    retirement = await options.retirementStore.update({
      ...retirement,
      attemptCount: retirement.attemptCount + 1,
      reconciliationState: "pending_sync",
      lastError: null,
      updatedAt: now.toISOString(),
    });

    const balance = await options.ua.getUniversalBalance();
    const classified = classifyHoldings(balance);
    const conversionById = new Map(
      retirement.conversionLegs.map((leg) => [leg.legId, leg]),
    );

    for (const item of classified.conversions) {
      const legId = conversionLegId(item.fromAsset, item.fromChain);
      const existing = conversionById.get(legId);
      if (existing && isTerminalLegStatus(existing.status)) continue;

      if (existing?.status === "quoted") {
        const signable = signableFromLeg(existing);
        if (signable) {
          return { agent: options.agent, retirement, signable };
        }
      }

      const intent = {
        fromAsset: item.fromAsset,
        toAsset: "cash" as const,
        sizeUsd: item.sizeUsd,
        destChain: DEFAULT_DEST_CHAIN,
      };
      const quote = await options.ua.quoteTrade({
        intent,
        sizeUsd: item.sizeUsd,
      });
      const rootHash = rootHashFromQuote(quote);
      if (!rootHash) {
        throw new Error("Trade quote is missing a signable rootHash.");
      }
      const leg: RetirementConversionLeg = {
        ...(existing ??
          emptyConversionLeg(item.fromAsset, item.fromChain, item.sizeUsd)),
        sizeUsd: item.sizeUsd,
        status: "quoted",
        quote,
        rootHash,
        error: null,
      };
      conversionById.set(legId, leg);
      retirement = await options.retirementStore.update({
        ...retirement,
        conversionLegs: [...conversionById.values()],
        updatedAt: now.toISOString(),
      });
      const signable = signableFromLeg(leg);
      if (!signable) {
        throw new Error("Failed to build signable conversion leg.");
      }
      return { agent: options.agent, retirement, signable };
    }

    retirement = {
      ...retirement,
      conversionLegs: [...conversionById.values()],
    };

    if (classified.canonicalUsdcUsd > 0) {
      const existing = retirement.transferLeg;
      if (existing && isTerminalLegStatus(existing.status)) {
        await options.retirementStore.releaseRecovery({
          retirementId: retirement.retirementId,
          claimToken,
        });
        retirement = {
          ...retirement,
          recoveryClaimToken: null,
          recoveryClaimedAt: null,
        };
        return { agent: options.agent, retirement, signable: null };
      }
      if (existing?.status === "quoted") {
        const signable = signableFromLeg(existing);
        if (signable) {
          return { agent: options.agent, retirement, signable };
        }
      }

      const amount = classified.canonicalUsdcUsd.toFixed(6);
      validateRetirementWithdrawal({
        amount,
        destination: retirement.returnAddress,
        ownerAddress: options.agent.address,
        balance,
      });
      const quote = await options.ua.quoteWithdrawal({
        request: {
          asset: "usdc",
          destChain: "Arbitrum",
          amount,
          destination: retirement.returnAddress,
        },
      });
      assertTransferDestinationLocked(
        quote.destination,
        retirement.returnAddress,
      );
      const rootHash = rootHashFromQuote(quote);
      if (!rootHash) {
        throw new Error("Withdrawal quote is missing a signable rootHash.");
      }
      const transfer: RetirementTransferLeg = {
        ...(existing && existing.legId === transferLegId(retirement.returnAddress)
          ? existing
          : emptyTransferLeg(retirement.returnAddress, amount)),
        amount,
        destination: retirement.returnAddress,
        status: "quoted",
        quote: { ...quote, destination: retirement.returnAddress },
        rootHash,
        error: null,
      };
      retirement = await options.retirementStore.update({
        ...retirement,
        transferLeg: transfer,
        updatedAt: now.toISOString(),
      });
      const signable = signableFromLeg(transfer);
      if (!signable) {
        throw new Error("Failed to build signable transfer leg.");
      }
      return { agent: options.agent, retirement, signable };
    }

    if (
      !retirement.transferLeg ||
      !isTerminalLegStatus(retirement.transferLeg.status)
    ) {
      retirement = await options.retirementStore.update({
        ...retirement,
        transferLeg: {
          ...emptyTransferLeg(retirement.returnAddress, "0"),
          status: "skipped",
        },
        updatedAt: now.toISOString(),
      });
    }

    await options.retirementStore.releaseRecovery({
      retirementId: retirement.retirementId,
      claimToken,
    });
    retirement = {
      ...retirement,
      recoveryClaimToken: null,
      recoveryClaimedAt: null,
    };
    return { agent: options.agent, retirement, signable: null };
  } catch (error) {
    await options.retirementStore.releaseRecovery({
      retirementId: retirement.retirementId,
      claimToken,
    });
    throw error;
  }
}

async function sendStoredRetirementRaw(options: {
  ownerAddress: string;
  raw: RawTransaction;
  rootHashSignature: string;
  authorizations?: Array<{ userOpHash: string; signature: string }>;
}): Promise<string> {
  if (!options.raw.rootHash) {
    throw new Error("Stored retirement quote is missing rootHash.");
  }
  if (!options.rootHashSignature.startsWith("0x")) {
    throw new Error("Invalid rootHash signature.");
  }

  const projectId = process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
  const projectClientKey = process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
  const projectAppUuid = process.env.NEXT_PUBLIC_PARTICLE_APP_ID;
  if (!projectId || !projectClientKey || !projectAppUuid) {
    throw new AgentProvisioningError(
      "setup_not_ready",
      "Particle UA is not configured for live retirement recovery.",
    );
  }

  const { createParticleAccount } = await import("@/lib/ua/particle");
  const account = await createParticleAccount({
    ownerAddress: options.ownerAddress,
    projectId,
    projectClientKey,
    projectAppUuid,
  });
  const result = await account.sendTransaction(
    options.raw,
    options.rootHashSignature,
    options.authorizations,
  );
  return (
    result.transactionId ??
    options.raw.transactionId ??
    `retire-tx-${Date.now()}`
  );
}

/**
 * Live Particle step 2: submit CLI-provided signatures for a prepared leg.
 * Sends the stored rawTransaction — never silently requotes.
 */
export async function submitRetirementLeg(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    retirementId: string;
    legId: string;
    rootHashSignature: string;
    authorizations?: Array<{ userOpHash: string; signature: string }>;
    now?: Date;
  },
): Promise<RetirementRecoveryResult> {
  if (!hasParticleEnv()) {
    throw new AgentProvisioningError(
      "setup_not_ready",
      "Particle UA is not configured for live retirement recovery.",
    );
  }
  if (options.agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${options.agent.handle} must be retiring before recovery submit.`,
    );
  }

  let retirement = await loadOwnedRetirement(options);
  if (retirement.reconciliationState === "complete") {
    return { agent: options.agent, retirement };
  }

  const conversion = retirement.conversionLegs.find(
    (leg) => leg.legId === options.legId,
  );
  const transfer =
    retirement.transferLeg?.legId === options.legId
      ? retirement.transferLeg
      : null;
  const target = conversion ?? transfer;
  if (!target) {
    throw new AgentProvisioningError(
      "invalid_request",
      `Unknown retirement leg: ${options.legId}`,
    );
  }
  if (isTerminalLegStatus(target.status)) {
    return { agent: options.agent, retirement };
  }
  if (target.status !== "quoted" || !target.quote || !target.rootHash) {
    throw new AgentProvisioningError(
      "invalid_request",
      `Retirement leg ${options.legId} is not prepared for signing.`,
    );
  }

  const raw = rawFromQuote(target.quote);
  if (!raw?.rootHash || raw.rootHash !== target.rootHash) {
    throw new AgentProvisioningError(
      "invalid_request",
      "Stored retirement quote rootHash is missing or mismatched.",
    );
  }

  const now = options.now ?? new Date();
  const ownerAddress = options.agent.address;
  if (!ownerAddress) {
    throw new AgentProvisioningError(
      "invalid_request",
      "Agent address is required for live retirement submit.",
    );
  }

  if (conversion) {
    const legs = retirement.conversionLegs.map((leg) =>
      leg.legId === options.legId
        ? { ...leg, status: "in_flight" as const, error: null }
        : leg,
    );
    retirement = await options.retirementStore.update({
      ...retirement,
      conversionLegs: legs,
      updatedAt: now.toISOString(),
    });
    try {
      const transactionId = await sendStoredRetirementRaw({
        ownerAddress,
        raw,
        rootHashSignature: options.rootHashSignature,
        ...(options.authorizations
          ? { authorizations: options.authorizations }
          : {}),
      });
      const nextLegs = retirement.conversionLegs.map((leg) =>
        leg.legId === options.legId
          ? {
              ...leg,
              status: "complete" as const,
              transactionId,
              receiptId: transactionId,
              error: null,
            }
          : leg,
      );
      retirement = await options.retirementStore.update({
        ...retirement,
        conversionLegs: nextLegs,
        recoveredUsd: retirement.recoveredUsd + conversion.sizeUsd,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
        updatedAt: now.toISOString(),
      });
      return { agent: options.agent, retirement };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Conversion submit failed during retirement recovery.";
      const nextLegs = retirement.conversionLegs.map((leg) =>
        leg.legId === options.legId
          ? { ...leg, status: "failed" as const, error: message }
          : leg,
      );
      retirement = await options.retirementStore.update({
        ...retirement,
        conversionLegs: nextLegs,
        reconciliationState: "needs_attention",
        lastError: message,
        recoveryClaimToken: null,
        recoveryClaimedAt: null,
        updatedAt: now.toISOString(),
      });
      return { agent: options.agent, retirement };
    }
  }

  const transferLeg = transfer!;
  assertTransferDestinationLocked(
    transferLeg.destination,
    retirement.returnAddress,
  );
  retirement = await options.retirementStore.update({
    ...retirement,
    transferLeg: { ...transferLeg, status: "in_flight", error: null },
    updatedAt: now.toISOString(),
  });
  try {
    const transactionId = await sendStoredRetirementRaw({
      ownerAddress,
      raw,
      rootHashSignature: options.rootHashSignature,
      ...(options.authorizations
        ? { authorizations: options.authorizations }
        : {}),
    });
    const amountUsd = Number(transferLeg.amount ?? 0);
    retirement = await options.retirementStore.update({
      ...retirement,
      transferLeg: {
        ...transferLeg,
        status: "complete",
        transactionId,
        receiptId: transactionId,
        error: null,
      },
      recoveredUsd: retirement.recoveredUsd + (Number.isFinite(amountUsd) ? amountUsd : 0),
      recoveryClaimToken: null,
      recoveryClaimedAt: null,
      updatedAt: now.toISOString(),
    });
    return { agent: options.agent, retirement };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Transfer submit failed during retirement recovery.";
    retirement = await options.retirementStore.update({
      ...retirement,
      transferLeg: {
        ...transferLeg,
        status: "failed",
        error: message,
      },
      reconciliationState: "needs_attention",
      lastError: message,
      recoveryClaimToken: null,
      recoveryClaimedAt: null,
      updatedAt: now.toISOString(),
    });
    return { agent: options.agent, retirement };
  }
}

/**
 * Live Particle step 3: after legs are terminal, dust-check and mark retired.
 */
export async function finalizeRetirementRecovery(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    agent: OwnedAgent;
    retirementId: string;
    ua: UAClient;
    now?: Date;
  },
): Promise<RetirementRecoveryResult> {
  let retirement = await loadOwnedRetirement(options);
  if (retirement.reconciliationState === "complete") {
    return { agent: options.agent, retirement };
  }
  if (options.agent.status === "retired") {
    return { agent: options.agent, retirement };
  }
  if (options.agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${options.agent.handle} must be retiring before finalize.`,
    );
  }

  const now = options.now ?? new Date();
  const unfinishedConversion = retirement.conversionLegs.find(
    (leg) => !isTerminalLegStatus(leg.status),
  );
  if (unfinishedConversion) {
    retirement = await options.retirementStore.update({
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: `Conversion leg ${unfinishedConversion.legId} is not complete.`,
      updatedAt: now.toISOString(),
    });
    return { agent: options.agent, retirement };
  }
  if (
    !retirement.transferLeg ||
    !isTerminalLegStatus(retirement.transferLeg.status)
  ) {
    retirement = await options.retirementStore.update({
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: "Canonical USDC transfer is not complete.",
      updatedAt: now.toISOString(),
    });
    return { agent: options.agent, retirement };
  }

  let balance: UniversalBalance;
  try {
    balance = await options.ua.getUniversalBalance();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not reconcile residual holdings after transfer.";
    retirement = await options.retirementStore.update({
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: message,
      updatedAt: now.toISOString(),
    });
    return { agent: options.agent, retirement };
  }

  const residualHoldings = buildResidualHoldings(classifyHoldings(balance));
  const residualTotal = residualHoldings.reduce((sum, item) => sum + item.usd, 0);
  const { residuals: dustMarked, dustUsd } = markResidualsDust(residualHoldings);
  retirement = {
    ...retirement,
    residualHoldings: dustMarked,
    dustUsd:
      dustUsd ||
      dustMarked
        .filter((item) => item.unrecoverableDust)
        .reduce((sum, item) => sum + item.usd, 0),
    updatedAt: now.toISOString(),
  };

  if (residualTotal >= RETIREMENT_DUST_THRESHOLD_USD) {
    retirement = await options.retirementStore.update({
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: `Recoverable residual value of $${residualTotal.toFixed(2)} remains. Retry with the original local signer.`,
    });
    return { agent: options.agent, retirement };
  }

  return completeRetirementRecord({
    store: options.store,
    retirementStore: options.retirementStore,
    auditStore: options.auditStore,
    agent: options.agent,
    retirement,
    now,
    actor: "operator",
    via: "finalize",
  });
}

/**
 * Operator-only retry after needs_attention. Re-enters recovery with the same
 * durable legs so completed conversions/transfers are never duplicated.
 */
export async function retryRetirementRecovery(
  options: {
    store: AgentProvisioningStore;
    retirementStore: AgentRetirementStore;
    auditStore: AgentAuditStore;
    ownerUserId: string;
    agentId: string;
    retirementId?: string;
    ua: UAClient;
    signers: TradeSigners;
    allowMock?: boolean;
    now?: Date;
    randomId?: () => string;
  },
): Promise<RetirementRecoveryResult> {
  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);

  if (agent.status === "retired") {
    const existing = await options.retirementStore.getByAgentId(agent.agentId);
    if (existing) {
      assertRetirementOwnership(existing, agent);
      return { agent, retirement: existing };
    }
  }
  if (agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and is not awaiting retirement retry.`,
    );
  }

  const retirement =
    (typeof options.retirementId === "string" && options.retirementId
      ? await options.retirementStore.get(options.retirementId)
      : null) ?? (await options.retirementStore.getByAgentId(agent.agentId));
  if (!retirement) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record exists for this agent.",
    );
  }
  assertRetirementOwnership(retirement, agent);

  if (retirement.reconciliationState === "complete") {
    return { agent, retirement };
  }

  // Clear needs_attention so recovery can proceed; keep completed legs intact.
  if (retirement.reconciliationState === "needs_attention") {
    await options.retirementStore.casReconciliationState({
      retirementId: retirement.retirementId,
      from: "needs_attention",
      to: "pending_sync",
      lastError: null,
    });
  }

  return executeRetirementRecovery({
    store: options.store,
    retirementStore: options.retirementStore,
    auditStore: options.auditStore,
    agent,
    retirementId: retirement.retirementId,
    ua: options.ua,
    signers: options.signers,
    ...(options.allowMock !== undefined
      ? { allowMock: options.allowMock }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomId ? { randomId: options.randomId } : {}),
  });
}

/**
 * Reconcile an already-receipted retirement without signing. Used by the
 * durable workflow after conversion/transfer legs are committed.
 */
export async function reconcileRetirementResiduals(options: {
  store: AgentProvisioningStore;
  retirementStore: AgentRetirementStore;
  auditStore: AgentAuditStore;
  retirementId: string;
  ua: UAClient;
  now?: Date;
}): Promise<AgentRetirementRecord> {
  const retirement = await options.retirementStore.get(options.retirementId);
  if (!retirement) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record matches that id.",
    );
  }
  if (retirement.reconciliationState === "complete") {
    return retirement;
  }

  // Retiring agents still occupy the non-retired slot until completion.
  const owned = await options.store.findNonRetiredByOwner(
    retirement.ownerUserId,
  );
  if (!owned || owned.agentId !== retirement.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that retirement record.",
    );
  }
  if (owned.status === "retired") {
    const completed = await options.retirementStore.casReconciliationState({
      retirementId: retirement.retirementId,
      from: retirement.reconciliationState,
      to: "complete",
      completedAt: owned.retiredAt ?? new Date().toISOString(),
      lastError: null,
    });
    return completed ?? retirement;
  }
  if (owned.status !== "retiring") {
    return retirement;
  }

  const now = options.now ?? new Date();

  // Never complete from an empty/stale balance alone — require receipted legs.
  const unfinishedConversion = retirement.conversionLegs.find(
    (leg) => !isTerminalLegStatus(leg.status),
  );
  if (
    unfinishedConversion ||
    !retirement.transferLeg ||
    !isTerminalLegStatus(retirement.transferLeg.status)
  ) {
    const next: AgentRetirementRecord = {
      ...retirement,
      reconciliationState: "needs_attention",
      lastError:
        "Cannot complete retirement until conversion and transfer legs are terminal. Retry with the original local signer.",
      attemptCount: retirement.attemptCount + 1,
      updatedAt: now.toISOString(),
    };
    return options.retirementStore.update(next);
  }

  // Without signers the workflow can only complete empty/dust inventories or
  // escalate. Value-moving retries stay operator/signer-authenticated.
  let balance: UniversalBalance;
  try {
    balance = await options.ua.getUniversalBalance();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not reconcile retirement residuals.";
    const updated = await options.retirementStore.casReconciliationState({
      retirementId: retirement.retirementId,
      from: retirement.reconciliationState,
      to: "needs_attention",
      lastError: message,
      attemptCount: retirement.attemptCount + 1,
    });
    return updated ?? retirement;
  }

  const residualHoldings = buildResidualHoldings(classifyHoldings(balance)).map(
    (item) =>
      item.reason.includes("remained after recovery")
        ? {
            ...item,
            reason:
              "Routable holding still present; operator must retry recovery.",
          }
        : item.reason.includes("after the return-address")
          ? {
              ...item,
              reason:
                "Canonical USDC still present; operator must retry the return transfer.",
            }
          : item,
  );

  const residualTotal = residualHoldings.reduce((sum, item) => sum + item.usd, 0);
  const { residuals: dustMarked, dustUsd } = markResidualsDust(residualHoldings);

  if (residualTotal >= RETIREMENT_DUST_THRESHOLD_USD) {
    const next: AgentRetirementRecord = {
      ...retirement,
      residualHoldings: dustMarked,
      dustUsd,
      reconciliationState: "needs_attention",
      lastError: `Recoverable residual value of $${residualTotal.toFixed(2)} remains. Retry with the original local signer.`,
      attemptCount: retirement.attemptCount + 1,
      updatedAt: now.toISOString(),
    };
    return options.retirementStore.update(next);
  }

  const completed = await completeRetirementRecord({
    store: options.store,
    retirementStore: options.retirementStore,
    auditStore: options.auditStore,
    agent: owned,
    retirement: {
      ...retirement,
      residualHoldings: dustMarked,
      dustUsd:
        dustUsd ||
        dustMarked
          .filter((item) => item.unrecoverableDust)
          .reduce((sum, item) => sum + item.usd, 0),
      attemptCount: retirement.attemptCount + 1,
      updatedAt: now.toISOString(),
    },
    now,
    actor: "system",
    via: "workflow_reconcile",
  });
  return completed.retirement;
}
