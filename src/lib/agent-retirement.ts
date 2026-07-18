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
import type {
  BalanceSource,
  ProductAsset,
  TradeSigners,
  UniversalBalance,
} from "@/lib/verbs/types";

/** Aggregate residual USD that may complete as dust without blocking retirement. */
export const RETIREMENT_DUST_THRESHOLD_USD = 1;

export type RetirementReconciliationState =
  | "complete"
  | "pending_sync"
  | "needs_attention";

export type RetirementLegStatus = "pending" | "complete" | "failed" | "skipped";

export type RetirementConversionLeg = {
  legId: string;
  kind: "conversion";
  fromAsset: ProductAsset;
  fromChain: string;
  sizeUsd: number;
  status: RetirementLegStatus;
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

  clear(): void {
    this.records.clear();
    this.byAgent.clear();
    this.byIdempotency.clear();
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

/**
 * Idempotent recovery: convert routable holdings to Arbitrum USDC, transfer to
 * the locked return address, then reconcile residuals. Requires the original
 * local signer via TradeSigners — Conviction never reconstructs it.
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
    now?: Date;
    randomId?: () => string;
  },
): Promise<RetirementRecoveryResult> {
  if (options.agent.status === "retired") {
    const existing = await options.retirementStore.get(options.retirementId);
    if (existing) {
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

  let retirement = await options.retirementStore.get(options.retirementId);
  if (!retirement || retirement.agentId !== options.agent.agentId) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record matches that agent.",
    );
  }
  if (retirement.reconciliationState === "complete") {
    return { agent: options.agent, retirement };
  }

  const now = options.now ?? new Date();
  const returnAddress = retirement.returnAddress;
  if (getAddress(returnAddress) !== getAddress(options.agent.returnAddress)) {
    throw new AgentProvisioningError(
      "invalid_request",
      "Return address is locked for this retirement and cannot change.",
    );
  }

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

  retirement = {
    ...retirement,
    attemptCount: retirement.attemptCount + 1,
    updatedAt: now.toISOString(),
    lastError: null,
  };

  let balance: UniversalBalance;
  try {
    balance = await options.ua.getUniversalBalance();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not read agent holdings for retirement recovery.";
    retirement = {
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: message,
      updatedAt: now.toISOString(),
    };
    retirement = await options.retirementStore.update(retirement);
    return { agent: options.agent, retirement };
  }

  const classified = classifyHoldings(balance);
  const conversionById = new Map(
    retirement.conversionLegs.map((leg) => [leg.legId, leg]),
  );

  for (const item of classified.conversions) {
    const legId = conversionLegId(item.fromAsset, item.fromChain);
    const existing = conversionById.get(legId);
    if (existing?.status === "complete") continue;

    const leg: RetirementConversionLeg = existing ?? {
      legId,
      kind: "conversion",
      fromAsset: item.fromAsset,
      fromChain: item.fromChain,
      sizeUsd: item.sizeUsd,
      status: "pending",
      transactionId: null,
      receiptId: null,
      error: null,
    };
    leg.sizeUsd = item.sizeUsd;

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
      leg.status = "complete";
      leg.transactionId = result.transactionId;
      leg.receiptId = result.receipt.slug;
      leg.error = null;
    } catch (error) {
      leg.status = "failed";
      leg.error =
        error instanceof Error
          ? error.message
          : "Conversion failed during retirement recovery.";
    }
    conversionById.set(legId, leg);
  }

  retirement.conversionLegs = [...conversionById.values()];

  const failedConversion = retirement.conversionLegs.find(
    (leg) => leg.status === "failed",
  );
  if (failedConversion) {
    retirement = {
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: failedConversion.error,
      updatedAt: now.toISOString(),
    };
    retirement = await options.retirementStore.update(retirement);
    return { agent: options.agent, retirement };
  }

  // Refresh balance after conversions before the final transfer.
  try {
    balance = await options.ua.getUniversalBalance();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not re-read holdings after conversion.";
    retirement = {
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: message,
      updatedAt: now.toISOString(),
    };
    retirement = await options.retirementStore.update(retirement);
    return { agent: options.agent, retirement };
  }

  const afterConvert = classifyHoldings(balance);
  let recoveredUsd = retirement.recoveredUsd;

  if (afterConvert.canonicalUsdcUsd > 0) {
    const transferId = transferLegId(returnAddress);
    let transfer =
      retirement.transferLeg &&
      retirement.transferLeg.legId === transferId &&
      retirement.transferLeg.status === "complete"
        ? retirement.transferLeg
        : ({
            legId: transferId,
            kind: "transfer",
            asset: "usdc",
            destChain: "Arbitrum",
            amount: afterConvert.canonicalUsdcUsd.toFixed(6),
            destination: returnAddress,
            status: "pending",
            transactionId: null,
            receiptId: null,
            error: null,
          } satisfies RetirementTransferLeg);

    if (transfer.status !== "complete") {
      transfer = {
        ...transfer,
        amount: afterConvert.canonicalUsdcUsd.toFixed(6),
        destination: returnAddress,
      };
      try {
        const quote = await options.ua.quoteWithdrawal({
          request: {
            asset: "usdc",
            destChain: "Arbitrum",
            amount: transfer.amount!,
            destination: returnAddress,
          },
        });
        // Hard-lock destination to the stored return address (ADR 0035).
        if (getAddress(quote.destination) !== getAddress(returnAddress)) {
          throw new Error(
            "Withdrawal quote destination must equal the locked return address.",
          );
        }
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
        retirement = {
          ...retirement,
          transferLeg: transfer,
          reconciliationState: "needs_attention",
          lastError: transfer.error,
          updatedAt: now.toISOString(),
        };
        retirement = await options.retirementStore.update(retirement);
        return { agent: options.agent, retirement };
      }
    }
    retirement.transferLeg = transfer;
  } else if (!retirement.transferLeg) {
    retirement.transferLeg = {
      legId: transferLegId(returnAddress),
      kind: "transfer",
      asset: "usdc",
      destChain: "Arbitrum",
      amount: "0",
      destination: returnAddress,
      status: "skipped",
      transactionId: null,
      receiptId: null,
      error: null,
    };
  }

  // Final inventory for residual / dust accounting.
  try {
    balance = await options.ua.getUniversalBalance();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not reconcile residual holdings after transfer.";
    retirement = {
      ...retirement,
      recoveredUsd,
      reconciliationState: "needs_attention",
      lastError: message,
      updatedAt: now.toISOString(),
    };
    retirement = await options.retirementStore.update(retirement);
    return { agent: options.agent, retirement };
  }

  const finalClassified = classifyHoldings(balance);
  const residualHoldings: RetirementResidualHolding[] = [
    ...finalClassified.residuals,
  ];
  for (const item of finalClassified.conversions) {
    residualHoldings.push({
      asset: item.fromAsset.toUpperCase(),
      chain: item.fromChain,
      usd: item.sizeUsd,
      reason: "Routable holding remained after recovery attempt.",
      unrecoverableDust: false,
    });
  }
  if (finalClassified.canonicalUsdcUsd >= RETIREMENT_DUST_THRESHOLD_USD) {
    residualHoldings.push({
      asset: "USDC",
      chain: "Arbitrum",
      usd: finalClassified.canonicalUsdcUsd,
      reason: "Canonical USDC remained after the return-address transfer.",
      unrecoverableDust: false,
    });
  } else if (finalClassified.canonicalUsdcUsd > 0) {
    residualHoldings.push({
      asset: "USDC",
      chain: "Arbitrum",
      usd: finalClassified.canonicalUsdcUsd,
      reason: "Recorded as unrecoverable dust below the $1 retirement threshold.",
      unrecoverableDust: true,
    });
  }

  const residualTotal = residualHoldings.reduce((sum, item) => sum + item.usd, 0);
  const { residuals: dustMarked, dustUsd } = markResidualsDust(residualHoldings);

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

  if (residualTotal >= RETIREMENT_DUST_THRESHOLD_USD) {
    retirement = {
      ...retirement,
      reconciliationState: "needs_attention",
      lastError: `Recoverable residual value of $${residualTotal.toFixed(2)} remains (threshold $${RETIREMENT_DUST_THRESHOLD_USD.toFixed(2)}). Retry recovery with the original local signer.`,
    };
    retirement = await options.retirementStore.update(retirement);
    return { agent: options.agent, retirement };
  }

  const completedAgent = await options.store.completeRetirement({
    agentId: options.agent.agentId,
    ownerUserId: options.agent.ownerUserId,
    retiredAt: now.toISOString(),
  });

  retirement = {
    ...retirement,
    reconciliationState: "complete",
    completedAt: now.toISOString(),
    lastError: null,
  };
  retirement = await options.retirementStore.update(retirement);

  await appendAuditBestEffort(
    options.auditStore,
    buildAuditEvent({
      agentId: completedAgent.agentId,
      ownerUserId: completedAgent.ownerUserId,
      type: "retirement_completed",
      actor: "operator",
      now,
      details: {
        retirementId: retirement.retirementId,
        recoveredUsd: retirement.recoveredUsd,
        dustUsd: retirement.dustUsd,
        residualCount: retirement.residualHoldings.length,
      },
    }),
  );

  return { agent: completedAgent, retirement };
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
    ua: UAClient;
    signers: TradeSigners;
    now?: Date;
    randomId?: () => string;
  },
): Promise<RetirementRecoveryResult> {
  const agent = await options.store.findNonRetiredByOwner(options.ownerUserId);
  if (!agent || agent.agentId !== options.agentId) {
    // Also allow lookup of already-retired agents for idempotent complete replay.
    throw new AgentProvisioningError(
      "agent_not_found",
      "No agent matches that identity for this account.",
    );
  }
  assertOwner(agent, options.ownerUserId);

  if (agent.status === "retired") {
    const existing = await options.retirementStore.getByAgentId(agent.agentId);
    if (existing) return { agent, retirement: existing };
  }
  if (agent.status !== "retiring") {
    throw new AgentProvisioningError(
      "lifecycle_blocked",
      `Agent @${agent.handle} is ${agent.status} and is not awaiting retirement retry.`,
    );
  }

  const retirement = await options.retirementStore.getByAgentId(agent.agentId);
  if (!retirement) {
    throw new AgentProvisioningError(
      "agent_not_found",
      "No retirement record exists for this agent.",
    );
  }

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

  const classified = classifyHoldings(balance);
  const residualHoldings: RetirementResidualHolding[] = [
    ...classified.residuals,
  ];
  for (const item of classified.conversions) {
    residualHoldings.push({
      asset: item.fromAsset.toUpperCase(),
      chain: item.fromChain,
      usd: item.sizeUsd,
      reason: "Routable holding still present; operator must retry recovery.",
      unrecoverableDust: false,
    });
  }
  if (classified.canonicalUsdcUsd > 0) {
    residualHoldings.push({
      asset: "USDC",
      chain: "Arbitrum",
      usd: classified.canonicalUsdcUsd,
      reason:
        classified.canonicalUsdcUsd < RETIREMENT_DUST_THRESHOLD_USD
          ? "Recorded as unrecoverable dust below the $1 retirement threshold."
          : "Canonical USDC still present; operator must retry the return transfer.",
      unrecoverableDust:
        classified.canonicalUsdcUsd < RETIREMENT_DUST_THRESHOLD_USD,
    });
  }

  const residualTotal = residualHoldings.reduce((sum, item) => sum + item.usd, 0);
  const { residuals: dustMarked, dustUsd } = markResidualsDust(residualHoldings);
  const now = options.now ?? new Date();

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

  const completedAgent = await options.store.completeRetirement({
    agentId: owned.agentId,
    ownerUserId: owned.ownerUserId,
    retiredAt: now.toISOString(),
  });

  const next: AgentRetirementRecord = {
    ...retirement,
    residualHoldings: dustMarked,
    dustUsd:
      dustUsd ||
      dustMarked
        .filter((item) => item.unrecoverableDust)
        .reduce((sum, item) => sum + item.usd, 0),
    reconciliationState: "complete",
    completedAt: now.toISOString(),
    lastError: null,
    attemptCount: retirement.attemptCount + 1,
    updatedAt: now.toISOString(),
  };
  const saved = await options.retirementStore.update(next);

  await appendAuditBestEffort(
    options.auditStore,
    buildAuditEvent({
      agentId: completedAgent.agentId,
      ownerUserId: completedAgent.ownerUserId,
      type: "retirement_completed",
      actor: "system",
      now,
      details: {
        retirementId: saved.retirementId,
        recoveredUsd: saved.recoveredUsd,
        dustUsd: saved.dustUsd,
        via: "workflow_reconcile",
      },
    }),
  );

  return saved;
}
