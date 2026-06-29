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
