// Per-chain badge color for the Home holdings table. Chain display names come
// from BalanceSource.chain (already set via chainName in map-balance), so the
// only new data here is the brand color, keyed by that same name. The holdings
// view is the one place the design lets a network badge surface.

/** Muted swatch for unknown or multi-chain assets (the design system's --pt-fg-3). */
const NEUTRAL_COLOR = "var(--pt-fg-3)";

const CHAIN_COLORS: Record<string, string> = {
  base: "#0052FF",
  arbitrum: "#28A0F0",
  ethereum: "#627EEA",
  hyperliquid: "#97FCE4",
  solana: "#14F195",
  optimism: "#FF0420",
  polygon: "#8247E5",
};

/** Badge swatch color for a chain display name (case-insensitive). */
export function networkColor(chain: string): string {
  return CHAIN_COLORS[chain.trim().toLowerCase()] ?? NEUTRAL_COLOR;
}

/** Badge for assets spread across more than one chain. */
export const MULTI_NETWORK = { label: "Multiple", color: NEUTRAL_COLOR };
