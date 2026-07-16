// Per-chain display metadata for the Home holdings table. Chain names appear in
// the holdings view (a wallet-style breakdown) — the one place the design lets a
// network badge surface. Colors match each chain's brand mark.

type NetworkMeta = {
  /** Human label shown next to the badge. */
  label: string;
  /** Badge swatch color. */
  color: string;
};

const NETWORKS: Record<string, NetworkMeta> = {
  base: { label: "Base", color: "#0052FF" },
  arbitrum: { label: "Arbitrum", color: "#28A0F0" },
  ethereum: { label: "Ethereum", color: "#627EEA" },
  hyperliquid: { label: "Hyperliquid", color: "#97FCE4" },
  solana: { label: "Solana", color: "#14F195" },
  optimism: { label: "Optimism", color: "#FF0420" },
  polygon: { label: "Polygon", color: "#8247E5" },
};

const FALLBACK: NetworkMeta = { label: "Multiple", color: "#8C7A87" };

/** Resolve a chain name (case-insensitive) to its badge label + color. */
export function networkMeta(chain: string): NetworkMeta {
  return NETWORKS[chain.trim().toLowerCase()] ?? { label: chain, color: "#8C7A87" };
}

/** Badge for assets spread across more than one chain. */
export const MULTI_NETWORK = FALLBACK;
