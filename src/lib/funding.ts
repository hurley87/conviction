// Privy onramp target (ADR 0015): USDC on Base mainnet lands in the EOA = EVM
// Universal Account and unifies into the balance (ADR 0005). Base over Arbitrum
// for broader onramp-provider coverage; both unify identically.

import { BASE_CHAIN_ID } from "@/lib/verbs/chains";

/** Asset + chain the fiat onramp must deliver for UA unification. */
export const FUNDING_TARGET = {
  chainId: BASE_CHAIN_ID,
  asset: "USDC",
} as const;
