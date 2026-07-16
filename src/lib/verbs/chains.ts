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
  // Particle lists USDT as a primary on Arbitrum, not Base.
  usdt: {
    [ARBITRUM_CHAIN_ID]: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  },
  // Buy targets, per Particle's SUPPORTED_PRIMARY_TOKENS. ETH is native (zero
  // address) on both chains; BTC is WBTC. Wired on Base + Arbitrum so a buy can
  // settle wherever the funds already are (no bridge). Solana isn't an EVM
  // chain, so SOL has no address here and stays untradeable.
  eth: {
    [BASE_CHAIN_ID]: "0x0000000000000000000000000000000000000000",
    [ARBITRUM_CHAIN_ID]: "0x0000000000000000000000000000000000000000",
  },
  // BTC (cbBTC) is Base-only on purpose: btc isn't a plain v2 buy target, so
  // buys go through the warm-up flow — which has no router coverage on
  // Arbitrum. Settling on Base keeps "buy BTC" actually executable.
  btc: {
    [BASE_CHAIN_ID]: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  },
  // ARB settles on Arbitrum by definition — where Particle's router has no
  // non-primary coverage (verified 2026-07-14), so an ARB buy currently fails
  // at quote time with the friendly no-route message. Kept wired so it comes
  // back for free if Particle enables 42161 routing, and so the gate-kill
  // card's "no route through your account" is a live, provable check.
  arb: {
    [ARBITRUM_CHAIN_ID]: "0x912CE59144191C1204E64559FE8253a0e49E6548",
  },
};

/** Settlement chains we can build trades on, in default-preference order
 * (Arbitrum first, per ADR 0005). */
export const SETTLEMENT_CHAINS: DestChain[] = ["Arbitrum", "Base"];

/** True when value is a settlement chain name we can persist on a conviction. */
export function isDestChain(value: unknown): value is DestChain {
  return (
    typeof value === "string" &&
    (SETTLEMENT_CHAINS as readonly string[]).includes(value)
  );
}

const DEST_CHAIN_IDS: Record<DestChain, number> = {
  Arbitrum: ARBITRUM_CHAIN_ID,
  Base: BASE_CHAIN_ID,
};

/** Chain id for a settlement chain name. */
export function destChainId(dest: DestChain): number {
  return DEST_CHAIN_IDS[dest];
}

/** Settlement chain name for a chain id — undefined when we can't settle
 * there (e.g. Ethereum mainnet tokens are not backable yet). */
export function destChainFromId(chainId: number): DestChain | undefined {
  return (Object.keys(DEST_CHAIN_IDS) as DestChain[]).find(
    (chain) => DEST_CHAIN_IDS[chain] === chainId,
  );
}

/** Resolve a UA token type + chain id to a known contract address, if any. */
export function tokenAddress(
  uaTokenType: string,
  chainId: number,
): string | undefined {
  return TOKEN_ADDRESSES[uaTokenType]?.[chainId];
}
