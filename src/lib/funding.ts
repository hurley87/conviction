// Privy onramp target (ADR 0015): USDC on Arbitrum mainnet lands in the EOA =
// EVM Universal Account and unifies into the balance (ADR 0005).

import { ARBITRUM_CHAIN_ID } from "@/lib/verbs/chains";

/** Asset + chain the fiat onramp must deliver for UA unification. */
export const FUNDING_TARGET = {
  chainId: ARBITRUM_CHAIN_ID,
  asset: "USDC",
} as const;
