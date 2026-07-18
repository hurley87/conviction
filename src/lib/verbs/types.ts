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

/** Product asset labels the parser maps to UA token types. "token" is the
 * sentinel for a concrete TokenRef carried alongside the intent — never
 * emitted by the parser, only by structured callers (deck cards). */
export type ProductAsset =
  | "cash"
  | "eth"
  | "usdc"
  | "usdt"
  | "btc"
  | "sol"
  | "arb"
  | "token";

/** A concrete routable token by address — how cards reference assets outside
 * the product set. Routability is proven at quote time (the warm-up flow),
 * which is also what gate-check runs before a card is published. */
export type TokenRef = {
  chainId: number;
  address: string;
  symbol: string;
};

/** Constrained trade intent schema (ADR 0012). */
export type TradeIntent = {
  fromAsset?: ProductAsset;
  toAsset: ProductAsset;
  /** Concrete token target; requires toAsset: "token". Buy-only. */
  token?: TokenRef;
  /** Fixed dollar amount when set. */
  sizeUsd?: number;
  /** Fraction of unified balance (0–1) when set. Mutually exclusive with sizeUsd. */
  fraction?: number;
  /**
   * Settlement chain. Set when the user named one explicitly ("on Arbitrum");
   * otherwise left unset so the caller can pickSettlementChain from balance.
   */
  destChain?: DestChain;
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
  /** True when this execution signed a first-time in-place upgrade auth. */
  signed7702Auth?: boolean;
};

/** Trade metadata attached to a conviction feed entry. */
export type ConvictionTrade = {
  fromAsset: ProductAsset;
  fromChain: string;
  toAsset: ProductAsset;
  /** Concrete token the conviction is about, when outside the product set —
   * copies re-target it exactly (same address, same chain). */
  token?: TokenRef;
  toChain: DestChain;
  /** Presentation-only size (ADR 0003); not the copy amount. */
  sizeUsd: number;
};

/** Dated event on a conviction's why-now timeline (ADR 0016). */
export type WhyNowEvent = {
  at: string;
  event: string;
};

/** One diligence check in a gate report (ADR 0016). */
/** Stable diligence-check identity (gate module + card keys). */
export type GateCheckId = "liquidity" | "contract" | "routability";

/**
 * One diligence check on a card's gate report (ADR 0016).
 * `name` is stable across pass/fail; `detail` carries kill-card copy on failure.
 */
export type GateCheck = {
  id?: GateCheckId;
  name: string;
  passed: boolean;
  detail?: string;
  evidenceUrl?: string;
};

/**
 * Immutable authorship captured at publication time (ADR 0018 / 0025 / 0026).
 * Present on agent-authored convictions; absent on human/desk posts.
 */
export type AuthorshipSnapshot = {
  agentId: string;
  authorKind: "agent";
  handle: string;
  operatorHandle: string;
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
  /** Optional card anatomy — why-now timeline (ADR 0016). */
  whyNow?: WhyNowEvent[];
  /** Optional card anatomy — falsifier (ADR 0016). */
  whatBreaksIt?: string;
  /** Optional card anatomy — structured gate report (ADR 0016). */
  gateReport?: GateCheck[];
  /** Immutable agent authorship snapshot (ADR 0026). */
  authorship?: AuthorshipSnapshot;
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

/** Withdrawable primary assets (Settings → external wallet send). */
export type WithdrawalAsset = "eth" | "usdc" | "usdt";

/** Validated external-wallet withdrawal request. */
export type WithdrawalRequest = {
  asset: WithdrawalAsset;
  destChain: DestChain;
  /** Human-readable token amount (e.g. "25.5" USDC, "0.01" ETH). */
  amount: string;
  /** Checksummed EVM destination. */
  destination: string;
};

/** Jargon-light quote for the withdrawal confirm card. */
export type WithdrawalQuote = {
  asset: WithdrawalAsset;
  destChain: DestChain;
  amount: string;
  destination: string;
  /** Estimated unified-balance debit in USD. */
  estimatedDebitUsd: number;
  feeUsd: number;
  /** Maximum debit the user agreed to; abort execute if exceeded. */
  maxDebitUsd: number;
  etaSeconds: number;
  transactionId: string;
  rawTransaction: unknown;
};

export type WithdrawalResult = {
  transactionId: string;
  summary: string;
  estimatedDebitUsd: number;
  feeUsd: number;
  asset: WithdrawalAsset;
  destChain: DestChain;
  amount: string;
  destination: string;
  /** True when this execution signed a first-time in-place upgrade auth. */
  signed7702Auth?: boolean;
};

/** Debit/fee moved above the agreed ceiling at execute time. */
export class WithdrawalStaleQuoteError extends Error {
  constructor(
    message: string,
    public readonly freshQuote: WithdrawalQuote,
  ) {
    super(message);
    this.name = "WithdrawalStaleQuoteError";
  }
}
