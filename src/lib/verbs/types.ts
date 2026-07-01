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

/** Supported settlement chain names. Cash settles on Arbitrum (ADR 0005); a
 * crypto buy settles on whichever supported chain holds the funds, to avoid
 * bridge fees. */
export type DestChain = "Arbitrum" | "Base";

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
  /** Minimum received floor (quoted out − 1%); enforced at the SDK via
   * slippageBps and re-checked before execution (ADR 0011). */
  floorUsd: number;
  /** Internal — used for receipt, not shown on confirm card. */
  sourceChain: string;
  destChain: DestChain;
  /** Destination product asset — the fallback receipt token label. */
  toAsset: ProductAsset;
  /** The token actually received on-chain (e.g. "wstETH"), when the SDK reports
   * it. Preferred over toAsset for the receipt label. */
  receivedSymbol?: string;
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

/** Trade metadata attached to a conviction feed entry. */
export type ConvictionTrade = {
  fromAsset: ProductAsset;
  fromChain: string;
  toAsset: ProductAsset;
  toChain: DestChain;
  /** Presentation-only size (ADR 0003); not the copy amount. */
  sizeUsd: number;
};

/** A posted trade + thesis on the public feed (PRD). */
export type ConvictionEntry = {
  entryId: string;
  /** Denormalized feed identity (ADR 0009). */
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  createdAt: string;
  backedBy: string[];
  receiptSlug?: string;
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
