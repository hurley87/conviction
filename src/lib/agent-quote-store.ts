import "server-only";
import { getSql } from "@/lib/db";
import {
  MemoryAgentQuoteStore,
  type AgentQuoteStore,
  type AgentTradeQuoteRecord,
} from "@/lib/agent-quote";
import type { DestChain, GateCheck, ProductAsset, TradeIntent } from "@/lib/verbs/types";

const memoryStore = new MemoryAgentQuoteStore();
let neonSchemaReady = false;

type QuoteRow = {
  quote_id: string;
  agent_id: string;
  action: string;
  intent_fingerprint: string;
  intent: unknown;
  size_usd: string | number;
  publication_intent: boolean;
  dollars_in: string | number;
  dollars_out: string | number;
  fee_usd: string | number;
  floor_usd: string | number;
  source_chain: string;
  dest_chain: string;
  to_asset: string;
  received_symbol: string | null;
  transaction_id: string;
  raw_transaction: unknown;
  provider_expires_at: string | null;
  issued_at: string;
  expires_at: string;
  used: boolean;
  eligible_for_execution: boolean;
  gate_report: unknown;
  gate_version: string | null;
  target_fingerprint: string | null;
  gate_expires_at: string | null;
};

function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function recordFromRow(row: QuoteRow): AgentTradeQuoteRecord {
  return {
    quoteId: row.quote_id,
    agentId: row.agent_id,
    action: "trade",
    intentFingerprint: row.intent_fingerprint,
    intent: row.intent as TradeIntent,
    sizeUsd: num(row.size_usd),
    publicationIntent: row.publication_intent,
    dollarsIn: num(row.dollars_in),
    dollarsOut: num(row.dollars_out),
    feeUsd: num(row.fee_usd),
    floorUsd: num(row.floor_usd),
    sourceChain: row.source_chain,
    destChain: row.dest_chain as DestChain,
    toAsset: row.to_asset as ProductAsset,
    ...(row.received_symbol ? { receivedSymbol: row.received_symbol } : {}),
    transactionId: row.transaction_id,
    rawTransaction: row.raw_transaction,
    providerExpiresAt: row.provider_expires_at
      ? new Date(row.provider_expires_at).toISOString()
      : null,
    issuedAt: new Date(row.issued_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    used: row.used,
    eligibleForExecution: row.eligible_for_execution,
    ...(Array.isArray(row.gate_report)
      ? { gateReport: row.gate_report as GateCheck[] }
      : {}),
    ...(row.gate_version ? { gateVersion: row.gate_version } : {}),
    ...(row.target_fingerprint
      ? { targetFingerprint: row.target_fingerprint }
      : {}),
    ...(row.gate_expires_at
      ? { gateExpiresAt: new Date(row.gate_expires_at).toISOString() }
      : {}),
  };
}

class NeonAgentQuoteStore implements AgentQuoteStore {
  constructor(private readonly sql: NonNullable<ReturnType<typeof getSql>>) {}

  private async ensureSchema(): Promise<void> {
    if (neonSchemaReady) return;
    await this.sql`
      CREATE TABLE IF NOT EXISTS agent_trade_quotes (
        quote_id uuid PRIMARY KEY,
        agent_id uuid NOT NULL,
        action text NOT NULL CHECK (action = 'trade'),
        intent_fingerprint text NOT NULL,
        intent jsonb NOT NULL,
        size_usd numeric NOT NULL,
        publication_intent boolean NOT NULL DEFAULT false,
        dollars_in numeric NOT NULL,
        dollars_out numeric NOT NULL,
        fee_usd numeric NOT NULL,
        floor_usd numeric NOT NULL,
        source_chain text NOT NULL,
        dest_chain text NOT NULL,
        to_asset text NOT NULL,
        received_symbol text,
        transaction_id text NOT NULL,
        raw_transaction jsonb NOT NULL,
        provider_expires_at timestamptz,
        issued_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        used boolean NOT NULL DEFAULT false,
        eligible_for_execution boolean NOT NULL DEFAULT true,
        gate_report jsonb,
        gate_version text,
        target_fingerprint text,
        gate_expires_at timestamptz
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS agent_trade_quotes_agent_id
        ON agent_trade_quotes (agent_id)
    `;
    neonSchemaReady = true;
  }

  async save(record: AgentTradeQuoteRecord): Promise<AgentTradeQuoteRecord> {
    await this.ensureSchema();
    await this.sql`
      INSERT INTO agent_trade_quotes (
        quote_id,
        agent_id,
        action,
        intent_fingerprint,
        intent,
        size_usd,
        publication_intent,
        dollars_in,
        dollars_out,
        fee_usd,
        floor_usd,
        source_chain,
        dest_chain,
        to_asset,
        received_symbol,
        transaction_id,
        raw_transaction,
        provider_expires_at,
        issued_at,
        expires_at,
        used,
        eligible_for_execution,
        gate_report,
        gate_version,
        target_fingerprint,
        gate_expires_at
      ) VALUES (
        ${record.quoteId}::uuid,
        ${record.agentId}::uuid,
        ${record.action},
        ${record.intentFingerprint},
        ${JSON.stringify(record.intent)}::jsonb,
        ${record.sizeUsd},
        ${record.publicationIntent},
        ${record.dollarsIn},
        ${record.dollarsOut},
        ${record.feeUsd},
        ${record.floorUsd},
        ${record.sourceChain},
        ${record.destChain},
        ${record.toAsset},
        ${record.receivedSymbol ?? null},
        ${record.transactionId},
        ${JSON.stringify(record.rawTransaction ?? null)}::jsonb,
        ${record.providerExpiresAt}::timestamptz,
        ${record.issuedAt}::timestamptz,
        ${record.expiresAt}::timestamptz,
        ${record.used},
        ${record.eligibleForExecution},
        ${record.gateReport ? JSON.stringify(record.gateReport) : null}::jsonb,
        ${record.gateVersion ?? null},
        ${record.targetFingerprint ?? null},
        ${record.gateExpiresAt ?? null}::timestamptz
      )
    `;
    return record;
  }

  async get(quoteId: string): Promise<AgentTradeQuoteRecord | null> {
    await this.ensureSchema();
    const rows = (await this.sql`
      SELECT *
      FROM agent_trade_quotes
      WHERE quote_id = ${quoteId}::uuid
      LIMIT 1
    `) as QuoteRow[];
    const row = rows[0];
    return row ? recordFromRow(row) : null;
  }
}

/** Neon-authoritative when DATABASE_URL is set; memory fallback for local/mock. */
export function getAgentQuoteStore(): AgentQuoteStore {
  const sql = getSql();
  if (sql) return new NeonAgentQuoteStore(sql);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Agent quote storage is not configured.");
  }
  return memoryStore;
}

/** Test helper — reset the in-memory quote store between cases. */
export function resetMemoryAgentQuoteStoreForTests(): void {
  memoryStore.clear();
}
