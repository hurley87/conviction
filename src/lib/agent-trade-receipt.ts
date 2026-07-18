// Agent-owned trade receipts with one-time publishable status (ADR 0027 / 0033).
// Successful execute persists a publishable record; publish consumes it atomically.

import type {
  DestChain,
  GateCheck,
  ProductAsset,
  Receipt,
  TradeIntent,
} from "@/lib/verbs/types";

/** 24h publication window after execution for pre-trade gate reuse (ADR 0033). */
export const PUBLICATION_GATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AgentTradeReceiptKind = "trade";

export type AgentTradeReceiptRecord = {
  receiptId: string;
  agentId: string;
  kind: AgentTradeReceiptKind;
  status: "success";
  receipt: Receipt;
  entryAt: string;
  quoteId: string;
  quoteFingerprint: string;
  intent: TradeIntent;
  sizeUsd: number;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  sourceChain: string;
  destChain: DestChain;
  toAsset: ProductAsset;
  receivedSymbol?: string;
  publicationIntent: boolean;
  gateReport?: GateCheck[];
  gateVersion?: string;
  targetFingerprint?: string;
  /** True until a conviction is created from this receipt. */
  publishable: boolean;
  publishedEntryId?: string;
  consumedAt?: string;
};

export type AgentTradeReceiptStore = {
  save(record: AgentTradeReceiptRecord): Promise<void>;
  get(receiptId: string): Promise<AgentTradeReceiptRecord | null>;
  /**
   * Atomically consume publishable status. Returns the updated record when this
   * caller wins the CAS, or null when already consumed / missing / not owned.
   */
  consumeForPublish(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
    consumedAt: string;
  }): Promise<AgentTradeReceiptRecord | null>;
  /**
   * Roll back a consume owned by this entryId so a failed conviction save can
   * retry without stranding the receipt.
   */
  releasePublishConsume(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
  }): Promise<boolean>;
};

/** In-memory store for tests and offline mock paths. */
export class MemoryAgentTradeReceiptStore implements AgentTradeReceiptStore {
  private readonly records = new Map<string, AgentTradeReceiptRecord>();

  async save(record: AgentTradeReceiptRecord): Promise<void> {
    const existing = this.records.get(record.receiptId);
    // Never un-consume a published receipt (ADR 0027).
    if (existing && !existing.publishable) {
      this.records.set(record.receiptId, {
        ...structuredClone(record),
        publishable: false,
        ...(existing.publishedEntryId
          ? { publishedEntryId: existing.publishedEntryId }
          : {}),
        ...(existing.consumedAt ? { consumedAt: existing.consumedAt } : {}),
      });
      return;
    }
    this.records.set(record.receiptId, structuredClone(record));
  }

  async get(receiptId: string): Promise<AgentTradeReceiptRecord | null> {
    const stored = this.records.get(receiptId);
    return stored ? structuredClone(stored) : null;
  }

  async consumeForPublish(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
    consumedAt: string;
  }): Promise<AgentTradeReceiptRecord | null> {
    const stored = this.records.get(input.receiptId);
    if (!stored) return null;
    if (stored.agentId !== input.agentId) return null;
    if (!stored.publishable) return null;
    const next: AgentTradeReceiptRecord = {
      ...stored,
      publishable: false,
      publishedEntryId: input.entryId,
      consumedAt: input.consumedAt,
    };
    this.records.set(input.receiptId, next);
    return structuredClone(next);
  }

  async releasePublishConsume(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
  }): Promise<boolean> {
    const stored = this.records.get(input.receiptId);
    if (!stored) return false;
    if (stored.agentId !== input.agentId) return false;
    if (stored.publishedEntryId !== input.entryId) return false;
    if (stored.publishable) return false;
    const next: AgentTradeReceiptRecord = {
      ...stored,
      publishable: true,
    };
    delete next.publishedEntryId;
    delete next.consumedAt;
    this.records.set(input.receiptId, next);
    return true;
  }

  clear(): void {
    this.records.clear();
  }
}

export function buildAgentTradeReceiptRecord(input: {
  agentId: string;
  receipt: Receipt;
  entryAt: string;
  quoteId: string;
  quoteFingerprint: string;
  intent: TradeIntent;
  sizeUsd: number;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  sourceChain: string;
  destChain: DestChain;
  toAsset: ProductAsset;
  receivedSymbol?: string;
  publicationIntent: boolean;
  gateReport?: GateCheck[];
  gateVersion?: string;
  targetFingerprint?: string;
}): AgentTradeReceiptRecord {
  return {
    receiptId: input.receipt.slug,
    agentId: input.agentId,
    kind: "trade",
    status: "success",
    receipt: structuredClone(input.receipt),
    entryAt: input.entryAt,
    quoteId: input.quoteId,
    quoteFingerprint: input.quoteFingerprint,
    intent: structuredClone(input.intent),
    sizeUsd: input.sizeUsd,
    dollarsIn: input.dollarsIn,
    dollarsOut: input.dollarsOut,
    feeUsd: input.feeUsd,
    sourceChain: input.sourceChain,
    destChain: input.destChain,
    toAsset: input.toAsset,
    ...(input.receivedSymbol ? { receivedSymbol: input.receivedSymbol } : {}),
    publicationIntent: input.publicationIntent,
    ...(input.gateReport ? { gateReport: structuredClone(input.gateReport) } : {}),
    ...(input.gateVersion ? { gateVersion: input.gateVersion } : {}),
    ...(input.targetFingerprint
      ? { targetFingerprint: input.targetFingerprint }
      : {}),
    publishable: true,
  };
}

/** True when a bound pre-trade gate may still be reused for publication. */
export function isPublicationGateWindowOpen(
  entryAt: string,
  now: Date,
): boolean {
  const executedMs = Date.parse(entryAt);
  if (!Number.isFinite(executedMs)) return false;
  return now.getTime() < executedMs + PUBLICATION_GATE_WINDOW_MS;
}
