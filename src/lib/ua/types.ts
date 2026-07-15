// The Universal Account adapter — the seam the verb layer calls. The UA SDK
// lives behind this so it can be mocked for fast unit coverage (ADR 0014).

import type {
  TradeIntent,
  TradeQuote,
  TradeResult,
  TradeSigners,
  UniversalBalance,
  DepositAddresses,
  WithdrawalQuote,
  WithdrawalRequest,
  WithdrawalResult,
} from "@/lib/verbs/types";

export type UpgradeResult = { upgraded: boolean; alreadyUpgraded: boolean };

export type QuoteTradeParams = {
  intent: TradeIntent;
  sizeUsd: number;
};

export type ExecuteTradeParams = {
  intent: TradeIntent;
  sizeUsd: number;
  agreedQuote: TradeQuote;
  signers: TradeSigners;
  receiptSlug: string;
};

export type QuoteWithdrawalParams = {
  request: WithdrawalRequest;
};

export type ExecuteWithdrawalParams = {
  request: WithdrawalRequest;
  agreedQuote: WithdrawalQuote;
  signers: TradeSigners;
};

export interface UAClient {
  /** getUniversalBalance() verb — wraps the SDK's getPrimaryAssets(). */
  getUniversalBalance(): Promise<UniversalBalance>;
  /** getDepositAddresses() verb — wraps the SDK's getSmartAccountOptions(). */
  getDepositAddresses(): Promise<DepositAddresses>;
  /** One-time EIP-7702 upgrade of the owner EOA in place (ADR 0004). */
  ensureUpgraded(): Promise<UpgradeResult>;
  /** quoteTrade() verb — UA quote shaped for the confirm card (ADR 0011). */
  quoteTrade(params: QuoteTradeParams): Promise<TradeQuote>;
  /** executeTrade() verb — cross-chain move via UA with floor enforcement. */
  executeTrade(params: ExecuteTradeParams): Promise<TradeResult>;
  /** quoteWithdrawal() — external transfer quote via createTransferTransaction. */
  quoteWithdrawal(params: QuoteWithdrawalParams): Promise<WithdrawalQuote>;
  /** executeWithdrawal() — sign + send transfer with debit ceiling re-check. */
  executeWithdrawal(params: ExecuteWithdrawalParams): Promise<WithdrawalResult>;
}
