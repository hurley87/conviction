// Chain metadata for gate-check: GeckoTerminal network slugs, explorer URLs,
// and Blockscout bases for verification + holder reads.

import {
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  chainName,
} from "@/lib/verbs/chains";

export type GateChainId = 1 | typeof BASE_CHAIN_ID | typeof ARBITRUM_CHAIN_ID;

export type GateChainInfo = {
  chainId: GateChainId;
  /** Display name, e.g. "Base". */
  name: string;
  /** GeckoTerminal network id. */
  geckoNetwork: string;
  /** Blockscout origin for free explorer API reads. */
  blockscoutOrigin: string;
  /** Token page on the chain's public explorer (evidence links). */
  explorerTokenUrl: (address: string) => string;
  /** GeckoTerminal token page (liquidity evidence). */
  geckoTokenUrl: (address: string) => string;
};

const GATE_CHAINS: Record<GateChainId, GateChainInfo> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    geckoNetwork: "eth",
    blockscoutOrigin: "https://eth.blockscout.com",
    explorerTokenUrl: (address) => `https://etherscan.io/token/${address}`,
    geckoTokenUrl: (address) =>
      `https://www.geckoterminal.com/eth/tokens/${address}`,
  },
  [BASE_CHAIN_ID]: {
    chainId: BASE_CHAIN_ID,
    name: "Base",
    geckoNetwork: "base",
    blockscoutOrigin: "https://base.blockscout.com",
    explorerTokenUrl: (address) => `https://basescan.org/token/${address}`,
    geckoTokenUrl: (address) =>
      `https://www.geckoterminal.com/base/tokens/${address}`,
  },
  [ARBITRUM_CHAIN_ID]: {
    chainId: ARBITRUM_CHAIN_ID,
    name: "Arbitrum",
    geckoNetwork: "arbitrum",
    blockscoutOrigin: "https://arbitrum.blockscout.com",
    explorerTokenUrl: (address) => `https://arbiscan.io/token/${address}`,
    geckoTokenUrl: (address) =>
      `https://www.geckoterminal.com/arbitrum/tokens/${address}`,
  },
};

const NAME_ALIASES: Record<string, GateChainId> = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  base: BASE_CHAIN_ID,
  arbitrum: ARBITRUM_CHAIN_ID,
  arb: ARBITRUM_CHAIN_ID,
  "arbitrum-one": ARBITRUM_CHAIN_ID,
};

/** Resolve a chain name or numeric id to gate metadata. */
export function resolveGateChain(chain: string | number): GateChainInfo {
  if (typeof chain === "number") {
    const info = GATE_CHAINS[chain as GateChainId];
    if (!info) {
      throw new Error(
        `Unsupported chain id ${chain}. Gate-check supports Ethereum (1), Base (${BASE_CHAIN_ID}), and Arbitrum (${ARBITRUM_CHAIN_ID}).`,
      );
    }
    return info;
  }

  const trimmed = chain.trim();
  if (/^\d+$/.test(trimmed)) {
    return resolveGateChain(Number(trimmed));
  }

  const id = NAME_ALIASES[trimmed.toLowerCase()];
  if (id == null) {
    throw new Error(
      `Unsupported chain "${chain}". Use base, ethereum, or arbitrum.`,
    );
  }
  return GATE_CHAINS[id];
}

export function gateChainLabel(chainId: number): string {
  return chainName(chainId);
}
