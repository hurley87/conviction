// Single source of chain metadata — display name + explorer base — keyed by
// chain id. Both the balance mapper and the receipt builder read from here so a
// new chain is added in exactly one place (ADR 0013).

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
