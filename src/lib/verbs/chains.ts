// Single source of chain metadata — display name + explorer base — keyed by
// chain id. Both the balance mapper and the receipt builder read from here so a
// new chain is added in exactly one place (ADR 0013).

import type { DestChain } from "@/lib/verbs/types";

/** Base mainnet — common deposit/source chain. */
export const BASE_CHAIN_ID = 8453;
/** Arbitrum mainnet — canonical settlement chain (ADR 0005). */
export const ARBITRUM_CHAIN_ID = 42161;

type ChainInfo = { name: string; explorerTxBase: string };

const CHAINS: Record<number, ChainInfo> = {
  1: { name: "Ethereum", explorerTxBase: "https://etherscan.io/tx/" },
  10: { name: "Optimism", explorerTxBase: "https://optimistic.etherscan.io/tx/" },
  56: { name: "BNB Chain", explorerTxBase: "https://bscscan.com/tx/" },
  137: { name: "Polygon", explorerTxBase: "https://polygonscan.com/tx/" },
  8453: { name: "Base", explorerTxBase: "https://basescan.org/tx/" },
  42161: { name: "Arbitrum", explorerTxBase: "https://arbiscan.io/tx/" },
  101: { name: "Solana", explorerTxBase: "https://solscan.io/tx/" },
};

export function chainName(chainId: number | undefined): string {
  if (chainId == null) return "Unknown";
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`;
}

export function explorerUrl(chainId: number, txHash: string): string {
  const base = CHAINS[chainId]?.explorerTxBase ?? "https://etherscan.io/tx/";
  return `${base}${txHash}`;
}

// Known token contract addresses by UA token type → chain id. Verified against
// the SDK's exported SUPPORTED_PRIMARY_TOKENS (Particle UA v2). createBuyTransaction
// needs a concrete {chainId, address} so the trade amount is actually bounded
// (an empty-transactions createUniversalTransaction sweeps the whole balance).
const TOKEN_ADDRESSES: Record<string, Record<number, string>> = {
  usdc: {
    [BASE_CHAIN_ID]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    [ARBITRUM_CHAIN_ID]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  // Buy targets, per Particle's SUPPORTED_PRIMARY_TOKENS. ETH is native (zero
  // address) on both chains; BTC is WBTC. Wired on Base + Arbitrum so a buy can
  // settle wherever the funds already are (no bridge). Solana isn't an EVM
  // chain, so SOL has no address here and stays untradeable.
  eth: {
    [BASE_CHAIN_ID]: "0x0000000000000000000000000000000000000000",
    [ARBITRUM_CHAIN_ID]: "0x0000000000000000000000000000000000000000",
  },
  btc: {
    [BASE_CHAIN_ID]: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    [ARBITRUM_CHAIN_ID]: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  },
  // ARB is Arbitrum-only on purpose: with no Base entry, pickSettlementChain's
  // only candidate is Arbitrum, so buying ARB from funds elsewhere is always
  // the cross-chain move (hero card, ADR 0005). Buy-only — not a UA primary.
  arb: {
    [ARBITRUM_CHAIN_ID]: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  },
};

/** Settlement chains we can build trades on, in default-preference order
 * (Arbitrum first, per ADR 0005). */
export const SETTLEMENT_CHAINS: DestChain[] = ["Arbitrum", "Base"];

const DEST_CHAIN_IDS: Record<DestChain, number> = {
  Arbitrum: ARBITRUM_CHAIN_ID,
  Base: BASE_CHAIN_ID,
};

/** Chain id for a settlement chain name. */
export function destChainId(dest: DestChain): number {
  return DEST_CHAIN_IDS[dest];
}

/** Resolve a UA token type + chain id to a known contract address, if any. */
export function tokenAddress(
  uaTokenType: string,
  chainId: number,
): string | undefined {
  return TOKEN_ADDRESSES[uaTokenType]?.[chainId];
}
