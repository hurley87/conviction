import "server-only";
import { getSql } from "@/lib/db";
import {
  MemoryAgentTradeReceiptStore,
  type AgentTradeReceiptRecord,
  type AgentTradeReceiptStore,
} from "@/lib/agent-trade-receipt";
import type {
  DestChain,
  GateCheck,
  ProductAsset,
  Receipt,
  TradeIntent,
} from "@/lib/verbs/types";

const memoryStore = new MemoryAgentTradeReceiptStore();
let neonSchemaReady = false;

type TradeReceiptRow = {
  receipt_id: string;
  agent_id: string;
  kind: string;
  status: string;
  receipt: Receipt;
  entry_at: string;
  quote_id: string;
  quote_fingerprint: string;
  intent: TradeIntent;
  size_usd: string | number;
  dollars_in: string | number;
  dollars_out: string | number;
  fee_usd: string | number;
  source_chain: string;
  dest_chain: string;
  to_asset: string;
  received_symbol: string | null;
  publication_intent: boolean;
  gate_report: GateCheck[] | null;
  gate_version: string | null;
  target_fingerprint: string | null;
  publishable: boolean;
  published_entry_id: string | null;
  consumed_at: string | null;
};

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function recordFromRow(row: TradeReceiptRow): AgentTradeReceiptRecord {
  return {
    receiptId: row.receipt_id,
    agentId: row.agent_id,
    kind: "trade",
    status: "success",
    receipt: row.receipt,
    entryAt: new Date(row.entry_at).toISOString(),
    quoteId: row.quote_id,
    quoteFingerprint: row.quote_fingerprint,
    intent: row.intent,
    sizeUsd: num(row.size_usd),
    dollarsIn: num(row.dollars_in),
    dollarsOut: num(row.dollars_out),
    feeUsd: num(row.fee_usd),
    sourceChain: row.source_chain,
    destChain: row.dest_chain as DestChain,
    toAsset: row.to_asset as ProductAsset,
    ...(row.received_symbol ? { receivedSymbol: row.received_symbol } : {}),
    publicationIntent: row.publication_intent,
    ...(row.gate_report && row.gate_report.length > 0
      ? { gateReport: row.gate_report }
      : {}),
    ...(row.gate_version ? { gateVersion: row.gate_version } : {}),
    ...(row.target_fingerprint
      ? { targetFingerprint: row.target_fingerprint }
      : {}),
    publishable: row.publishable,
    ...(row.published_entry_id
      ? { publishedEntryId: row.published_entry_id }
      : {}),
    ...(row.consumed_at
      ? { consumedAt: new Date(row.consumed_at).toISOString() }
      : {}),
  };
}

async function ensureSchema(
  sql: NonNullable<ReturnType<typeof getSql>>,
): Promise<void> {
  if (neonSchemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_trade_receipts (
      receipt_id text PRIMARY KEY,
      agent_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind = 'trade'),
      status text NOT NULL CHECK (status = 'success'),
      receipt jsonb NOT NULL,
      entry_at timestamptz NOT NULL,
      quote_id text NOT NULL,
      quote_fingerprint text NOT NULL,
      intent jsonb NOT NULL,
      size_usd numeric NOT NULL,
      dollars_in numeric NOT NULL,
      dollars_out numeric NOT NULL,
      fee_usd numeric NOT NULL,
      source_chain text NOT NULL,
      dest_chain text NOT NULL,
      to_asset text NOT NULL,
      received_symbol text,
      publication_intent boolean NOT NULL DEFAULT false,
      gate_report jsonb,
      gate_version text,
      target_fingerprint text,
      publishable boolean NOT NULL DEFAULT true,
      published_entry_id text,
      consumed_at timestamptz
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS agent_trade_receipts_by_agent
      ON agent_trade_receipts (agent_id, entry_at DESC)
  `;
  neonSchemaReady = true;
}

class NeonAgentTradeReceiptStore implements AgentTradeReceiptStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  async save(record: AgentTradeReceiptRecord): Promise<void> {
    await ensureSchema(this.sql);
    await this.sql`
      INSERT INTO agent_trade_receipts (
        receipt_id, agent_id, kind, status, receipt, entry_at,
        quote_id, quote_fingerprint, intent, size_usd, dollars_in, dollars_out,
        fee_usd, source_chain, dest_chain, to_asset, received_symbol,
        publication_intent, gate_report, gate_version, target_fingerprint,
        publishable, published_entry_id, consumed_at
      )
      VALUES (
        ${record.receiptId},
        ${record.agentId}::uuid,
        ${record.kind},
        ${record.status},
        ${JSON.stringify(record.receipt)}::jsonb,
        ${record.entryAt}::timestamptz,
        ${record.quoteId},
        ${record.quoteFingerprint},
        ${JSON.stringify(record.intent)}::jsonb,
        ${record.sizeUsd},
        ${record.dollarsIn},
        ${record.dollarsOut},
        ${record.feeUsd},
        ${record.sourceChain},
        ${record.destChain},
        ${record.toAsset},
        ${record.receivedSymbol ?? null},
        ${record.publicationIntent},
        ${record.gateReport ? JSON.stringify(record.gateReport) : null}::jsonb,
        ${record.gateVersion ?? null},
        ${record.targetFingerprint ?? null},
        ${record.publishable},
        ${record.publishedEntryId ?? null},
        ${record.consumedAt ?? null}::timestamptz
      )
      ON CONFLICT (receipt_id) DO UPDATE SET
        receipt = EXCLUDED.receipt,
        quote_id = EXCLUDED.quote_id,
        quote_fingerprint = EXCLUDED.quote_fingerprint,
        intent = EXCLUDED.intent,
        size_usd = EXCLUDED.size_usd,
        dollars_in = EXCLUDED.dollars_in,
        dollars_out = EXCLUDED.dollars_out,
        fee_usd = EXCLUDED.fee_usd,
        source_chain = EXCLUDED.source_chain,
        dest_chain = EXCLUDED.dest_chain,
        to_asset = EXCLUDED.to_asset,
        received_symbol = EXCLUDED.received_symbol,
        publication_intent = EXCLUDED.publication_intent,
        gate_report = EXCLUDED.gate_report,
        gate_version = EXCLUDED.gate_version,
        target_fingerprint = EXCLUDED.target_fingerprint
      WHERE agent_trade_receipts.publishable = true
    `;
  }

  async get(receiptId: string): Promise<AgentTradeReceiptRecord | null> {
    await ensureSchema(this.sql);
    const rows = await this.sql`
      SELECT * FROM agent_trade_receipts
      WHERE receipt_id = ${receiptId}
      LIMIT 1
    `;
    const row = (rows as TradeReceiptRow[])[0];
    return row ? recordFromRow(row) : null;
  }

  async consumeForPublish(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
    consumedAt: string;
  }): Promise<AgentTradeReceiptRecord | null> {
    await ensureSchema(this.sql);
    const rows = await this.sql`
      UPDATE agent_trade_receipts
      SET
        publishable = false,
        published_entry_id = ${input.entryId},
        consumed_at = ${input.consumedAt}::timestamptz
      WHERE receipt_id = ${input.receiptId}
        AND agent_id = ${input.agentId}::uuid
        AND publishable = true
      RETURNING *
    `;
    const row = (rows as TradeReceiptRow[])[0];
    return row ? recordFromRow(row) : null;
  }

  async releasePublishConsume(input: {
    receiptId: string;
    agentId: string;
    entryId: string;
  }): Promise<boolean> {
    await ensureSchema(this.sql);
    const rows = await this.sql`
      UPDATE agent_trade_receipts
      SET
        publishable = true,
        published_entry_id = NULL,
        consumed_at = NULL
      WHERE receipt_id = ${input.receiptId}
        AND agent_id = ${input.agentId}::uuid
        AND publishable = false
        AND published_entry_id = ${input.entryId}
      RETURNING receipt_id
    `;
    return rows.length > 0;
  }
}

export function getAgentTradeReceiptStore(): AgentTradeReceiptStore {
  const sql = getSql();
  if (sql) return new NeonAgentTradeReceiptStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent trade receipt storage is not configured.");
  }
  return memoryStore;
}

/** Test helper — reset in-memory trade receipt state. */
export function resetAgentTradeReceiptStoreForTests(): void {
  memoryStore.clear();
  neonSchemaReady = false;
}
