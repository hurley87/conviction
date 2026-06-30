// Verb-layer types — the chain-agnostic contract both the in-app concierge and
// the MCP server depend on. Callers never see calldata or addresses.
// See docs/CONTEXT.md ("Verb layer", "Unified balance") and the PRD.

/** One chain/asset slice of the unified balance, in USD. */
export type BalanceSource = {
  /** Human chain name, e.g. "Arbitrum". Never shown in the main UI. */
  chain: string;
  /** Asset symbol, e.g. "USDC". Never shown in the main UI. */
  asset: string;
  usd: number;
};

/** The user's assets across all chains, shown and spendable as one number. */
export type UniversalBalance = {
  totalUsd: number;
  sources: BalanceSource[];
};

/** Deposit addresses from the SDK's account-options call (ADR 0002). */
export type DepositAddresses = {
  evm: string;
  /** Null until UA Solana support is confirmed for our network (ADR 0002). */
  solana: string | null;
};

/** Supported destination chain names (ADR 0005). */
export type DestChain = "Arbitrum";

/** Product asset labels the parser maps to UA token types. */
export type ProductAsset = "cash" | "eth" | "usdc" | "usdt" | "btc" | "sol";

/** Constrained trade intent schema (ADR 0012). */
export type TradeIntent = {
  fromAsset?: ProductAsset;
  toAsset: ProductAsset;
  /** Fixed dollar amount when set. */
  sizeUsd?: number;
  /** Fraction of unified balance (0–1) when set. Mutually exclusive with sizeUsd. */
  fraction?: number;
  destChain: DestChain;
};

export type ParseResult =
  | { kind: "intent"; intent: TradeIntent }
  | { kind: "clarify"; question: string };

export type ValidationResult =
  | { ok: true; intent: TradeIntent; sizeUsd: number }
  | { ok: false; error: string };

/** Jargon-free quote for the confirm card (ADR 0011). */
export type TradeQuote = {
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  etaSeconds: number;
  /** Minimum received floor passed to expectTokens (quoted out − 1%). */
  floorUsd: number;
  /** Internal — used for receipt, not shown on confirm card. */
  sourceChain: string;
  destChain: DestChain;
  /** Opaque SDK transaction payload for execute. */
  transactionId: string;
  rawTransaction: unknown;
};

export type ReceiptLeg = {
  chain: string;
  txHash: string;
  explorerUrl: string;
};

export type Receipt = {
  slug: string;
  legs: ReceiptLeg[];
  summary: string;
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
};

export type TradeResult = {
  transactionId: string;
  summary: string;
  receipt: Receipt;
};

/** Floor abort — execution re-quotes below the agreed floor (ADR 0011). */
export class FloorAbortError extends Error {
  constructor(
    message: string,
    public readonly freshQuote: TradeQuote,
  ) {
    super(message);
    this.name = "FloorAbortError";
  }
}

/** Signers injected from the React layer for 7702 + root-hash signing. */
export type TradeSigners = {
  signRootHash: (rootHash: string) => Promise<string>;
  sign7702: (auth: {
    contractAddress: string;
    chainId: number;
    nonce: number;
  }) => Promise<string>;
};
