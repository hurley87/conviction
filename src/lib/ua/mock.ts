// Deterministic mock UA client. Used by unit tests (ADR 0014) and as the
// local-dev fallback when Particle/Privy env is not configured, so the app and
// its tests run with zero credentials and no real funds.

import type {
  ExecuteTradeParams,
  QuoteTradeParams,
  UAClient,
  UpgradeResult,
} from "@/lib/ua/types";
import type { RawTransaction } from "@/lib/ua/trade";
import { ARBITRUM_CHAIN_ID, BASE_CHAIN_ID } from "@/lib/verbs/chains";
import { buildReceipt } from "@/lib/verbs/receipt";
import { shapeQuote, isBelowFloor } from "@/lib/verbs/quote";
import { narrateResult } from "@/lib/verbs/intent";
import {
  FloorAbortError,
  type TradeQuote,
  type TradeResult,
  type TradeSigners,
  type UniversalBalance,
  type DepositAddresses,
} from "@/lib/verbs/types";
import { sumSources } from "@/lib/verbs/map-balance";
import { emitUpgradedInPlace } from "@/lib/upgrade-beat";

/** Stub signers for mock/demo and unit tests — no real wallet (ADR 0014). */
export const mockTradeSigners: TradeSigners = {
  signRootHash: async () => "0xmockrootsig",
  sign7702: async () => "0xmock7702sig",
};

export type MockSeed = {
  /** Deposits across ≥2 chains, to mirror the unified-balance demo. */
  sources?: UniversalBalance["sources"];
  evm?: string;
  solana?: string | null;
  /** When true, executeTrade simulates a stale quote below the floor. */
  simulateStaleQuote?: boolean;
};

const DEFAULT_SOURCES: UniversalBalance["sources"] = [
  { chain: "Arbitrum", asset: "USDC", usd: 180.0 },
  { chain: "Base", asset: "ETH", usd: 62.5 },
];

/** Mock records the last quote intent for cross-chain differentiator tests. */
export type MockTradeRecord = {
  intent: QuoteTradeParams["intent"];
  sizeUsd: number;
  sourceChain: string;
  destChain: string;
};

export class MockUAClient implements UAClient {
  private upgraded = false;
  private lastQuote: TradeQuote | null = null;
  /** Exposed for unit tests (ADR 0014 differentiator). */
  readonly tradeRecords: MockTradeRecord[] = [];

  constructor(private readonly seed: MockSeed = {}) {}

  async getUniversalBalance(): Promise<UniversalBalance> {
    const sources = this.seed.sources ?? DEFAULT_SOURCES;
    return {
      totalUsd: sumSources(sources),
      sources,
    };
  }

  async getDepositAddresses(): Promise<DepositAddresses> {
    return {
      evm: this.seed.evm ?? "0xMockEOAUpgradedInPlace000000000000000000",
      solana: this.seed.solana ?? null,
    };
  }

  async ensureUpgraded(): Promise<UpgradeResult> {
    const alreadyUpgraded = this.upgraded;
    this.upgraded = true;
    if (!alreadyUpgraded) {
      emitUpgradedInPlace();
    }
    return { upgraded: !alreadyUpgraded, alreadyUpgraded };
  }

  private mockTokenChanges(sizeUsd: number, stale = false) {
    const fee = sizeUsd * 0.005;
    const dollarsOut = stale ? sizeUsd * 0.97 : sizeUsd - fee;
    return {
      totalDecrAmountInUSD: sizeUsd.toFixed(2),
      totalIncrAmountInUSD: dollarsOut.toFixed(2),
      totalFeeInUSD: fee.toFixed(2),
      decr: [{ token: { chainId: BASE_CHAIN_ID } }],
      incr: [{ token: { chainId: ARBITRUM_CHAIN_ID } }],
    };
  }

  private mockRawTransaction(
    sizeUsd: number,
    transactionId: string,
    stale = false,
  ): RawTransaction {
    return {
      transactionId,
      rootHash: `0xmockroot${transactionId}`,
      tokenChanges: this.mockTokenChanges(sizeUsd, stale),
      userOps: [
        {
          chainId: BASE_CHAIN_ID,
          userOpHash: `0xmocksource${transactionId}`,
        },
        {
          chainId: ARBITRUM_CHAIN_ID,
          userOpHash: `0xmockdest${transactionId}`,
        },
      ],
    };
  }

  async quoteTrade(params: QuoteTradeParams): Promise<TradeQuote> {
    const { intent, sizeUsd } = params;
    const txId = `mock-quote-${Date.now()}`;
    const raw = this.mockRawTransaction(sizeUsd, txId);
    const quote = shapeQuote(
      raw.tokenChanges!,
      intent,
      sizeUsd,
      txId,
      raw,
    );

    this.tradeRecords.push({
      intent,
      sizeUsd,
      sourceChain: quote.sourceChain,
      destChain: quote.destChain,
    });
    this.lastQuote = quote;
    return quote;
  }

  async executeTrade(params: ExecuteTradeParams): Promise<TradeResult> {
    const { intent, sizeUsd, agreedQuote, signers, receiptSlug } = params;
    const stale = this.seed.simulateStaleQuote ?? false;
    const txId = `mock-exec-${Date.now()}`;
    const raw = this.mockRawTransaction(sizeUsd, txId, stale);

    const freshQuote = shapeQuote(
      raw.tokenChanges!,
      intent,
      sizeUsd,
      txId,
      raw,
    );

    if (isBelowFloor(freshQuote.dollarsOut, agreedQuote.floorUsd)) {
      throw new FloorAbortError(
        "The quote moved — please confirm again.",
        freshQuote,
      );
    }

    if (raw.rootHash) {
      await signers.signRootHash(raw.rootHash);
    }

    // Mirror live first-tx upgrade auth so the beat can fire in mock/demo.
    if (!this.upgraded) {
      this.upgraded = true;
      emitUpgradedInPlace();
    }

    const receipt = buildReceipt(
      receiptSlug,
      {
        dollarsIn: freshQuote.dollarsIn,
        dollarsOut: freshQuote.dollarsOut,
        feeUsd: freshQuote.feeUsd,
        sourceChain: freshQuote.sourceChain,
        destChain: freshQuote.destChain,
        toAsset: freshQuote.toAsset,
        receivedSymbol: freshQuote.receivedSymbol,
      },
      raw.userOps,
    );

    return {
      transactionId: txId,
      summary: narrateResult(
        freshQuote.dollarsIn,
        freshQuote.dollarsOut,
        freshQuote.toAsset,
        freshQuote.receivedSymbol,
      ),
      receipt,
    };
  }
}
