// Deterministic mock UA client. Used by unit tests (ADR 0014) and as the
// local-dev fallback when Particle/Privy env is not configured, so the app and
// its tests run with zero credentials and no real funds.

import type {
  ExecuteTradeParams,
  ExecuteWithdrawalParams,
  QuoteTradeParams,
  QuoteWithdrawalParams,
  UAClient,
  UpgradeResult,
} from "@/lib/ua/types";
import type { RawTransaction } from "@/lib/ua/trade";
import {
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  destChainId,
} from "@/lib/verbs/chains";
import { buildReceipt, inferSpentSymbol } from "@/lib/verbs/receipt";
import { shapeQuote, isBelowFloor } from "@/lib/verbs/quote";
import { narrateResult } from "@/lib/verbs/intent";
import {
  isAboveMaxDebit,
  narrateWithdrawal,
  shapeWithdrawalQuote,
  withdrawalTokenRef,
} from "@/lib/verbs/withdrawal";
import {
  FloorAbortError,
  WithdrawalStaleQuoteError,
  type TradeQuote,
  type TradeResult,
  type TradeSigners,
  type UniversalBalance,
  type DepositAddresses,
  type WithdrawalQuote,
  type WithdrawalRequest,
  type WithdrawalResult,
} from "@/lib/verbs/types";
import { sumSources } from "@/lib/verbs/map-balance";

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
  /** When true, executeWithdrawal simulates a debit above the agreed ceiling. */
  simulateStaleWithdrawal?: boolean;
  /** When true, quote/execute withdrawal omit rootHash (error path). */
  omitWithdrawalRootHash?: boolean;
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

/** Mock records withdrawals for unit tests. */
export type MockWithdrawalRecord = {
  request: WithdrawalRequest;
  estimatedDebitUsd: number;
};

export class MockUAClient implements UAClient {
  private upgraded = false;
  private lastQuote: TradeQuote | null = null;
  /** Exposed for unit tests (ADR 0014 differentiator). */
  readonly tradeRecords: MockTradeRecord[] = [];
  /** Exposed for withdrawal unit tests. */
  readonly withdrawalRecords: MockWithdrawalRecord[] = [];

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

    // First mock trade mirrors live first-tx 7702 auth.
    const signed7702Auth = !this.upgraded;
    if (signed7702Auth) {
      this.upgraded = true;
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
        sourceSymbol: inferSpentSymbol(intent),
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
      signed7702Auth,
    };
  }

  private mockWithdrawalTokenChanges(
    request: WithdrawalRequest,
    stale = false,
  ) {
    const amount = Number(request.amount);
    // Stables ~1:1; ETH mock uses a fixed $2500/ETH so debit is deterministic.
    const baseDebit =
      request.asset === "eth" ? amount * 2500 : amount;
    const fee = Math.max(0.01, baseDebit * 0.005);
    const estimatedDebitUsd = stale ? baseDebit * 1.05 + fee : baseDebit + fee;
    return {
      totalDecrAmountInUSD: estimatedDebitUsd.toFixed(2),
      totalIncrAmountInUSD: "0",
      totalFeeInUSD: fee.toFixed(2),
      decr: [{ token: { chainId: destChainId(request.destChain) } }],
      incr: [],
    };
  }

  private mockWithdrawalRaw(
    request: WithdrawalRequest,
    transactionId: string,
    stale = false,
  ): RawTransaction {
    const token = withdrawalTokenRef(request.asset, request.destChain);
    if (!token) {
      throw new Error(
        `Unsupported withdrawal: ${request.asset} on ${request.destChain}`,
      );
    }
    return {
      transactionId,
      rootHash: this.seed.omitWithdrawalRootHash
        ? undefined
        : `0xmockwithdrawroot${transactionId}`,
      tokenChanges: this.mockWithdrawalTokenChanges(request, stale),
      userOps: [
        {
          chainId: token.chainId,
          userOpHash: `0xmockwithdrawop${transactionId}`,
        },
      ],
    };
  }

  async quoteWithdrawal(
    params: QuoteWithdrawalParams,
  ): Promise<WithdrawalQuote> {
    const { request } = params;
    const txId = `mock-withdraw-quote-${Date.now()}`;
    const raw = this.mockWithdrawalRaw(request, txId);
    const quote = shapeWithdrawalQuote(
      raw.tokenChanges!,
      request,
      txId,
      raw,
    );
    this.withdrawalRecords.push({
      request,
      estimatedDebitUsd: quote.estimatedDebitUsd,
    });
    return quote;
  }

  async executeWithdrawal(
    params: ExecuteWithdrawalParams,
  ): Promise<WithdrawalResult> {
    const { request, agreedQuote, signers } = params;
    const stale = this.seed.simulateStaleWithdrawal ?? false;
    const txId = `mock-withdraw-exec-${Date.now()}`;
    const raw = this.mockWithdrawalRaw(request, txId, stale);

    const freshQuote = shapeWithdrawalQuote(
      raw.tokenChanges!,
      request,
      txId,
      raw,
    );

    if (isAboveMaxDebit(freshQuote.estimatedDebitUsd, agreedQuote.maxDebitUsd)) {
      throw new WithdrawalStaleQuoteError(
        "The quote moved — please confirm again.",
        freshQuote,
      );
    }

    if (!raw.rootHash) {
      throw new Error("Transaction missing root hash");
    }

    await signers.signRootHash(raw.rootHash);

    const signed7702Auth = !this.upgraded;
    if (signed7702Auth) {
      this.upgraded = true;
    }

    return {
      transactionId: txId,
      summary: narrateWithdrawal(request),
      estimatedDebitUsd: freshQuote.estimatedDebitUsd,
      feeUsd: freshQuote.feeUsd,
      asset: request.asset,
      destChain: request.destChain,
      amount: request.amount,
      destination: request.destination,
      signed7702Auth,
    };
  }
}
