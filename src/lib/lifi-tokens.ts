// LI.FI token list + spot price + logo for feed display (issue #4).
// Client-side, 5-min cached, priority-sorted per docs/build-guide.md.

import { createClient, getTokens, ChainType } from "@lifi/sdk";
import type { Token } from "@lifi/types";
import { ARBITRUM_CHAIN_ID, BASE_CHAIN_ID } from "@/lib/verbs/chains";
import { assetLookupSymbols } from "@/lib/verbs/assets";
import type { ProductAsset } from "@/lib/verbs/types";

export type FeedToken = {
  symbol: string;
  name: string;
  logoURI?: string;
  priceUSD?: number;
  chainId: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const FEED_CHAINS = [ARBITRUM_CHAIN_ID, BASE_CHAIN_ID] as const;

const PRIORITY_SYMBOLS = [
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "USDC",
  "USDT",
  "SOL",
];

let cachedTokens: FeedToken[] | null = null;
let cachedAt = 0;

const lifiClient = createClient({ integrator: "conviction" });

function priorityRank(symbol: string): number {
  const upper = symbol.toUpperCase();
  const idx = PRIORITY_SYMBOLS.indexOf(upper);
  return idx === -1 ? PRIORITY_SYMBOLS.length + upper.charCodeAt(0) : idx;
}

function tokenToFeedToken(token: Token): FeedToken {
  const price =
    token.priceUSD != null ? Number(token.priceUSD) : undefined;
  return {
    symbol: token.symbol,
    name: token.name,
    logoURI: token.logoURI,
    priceUSD: Number.isFinite(price) ? price : undefined,
    chainId: token.chainId,
  };
}

function dedupeBySymbol(tokens: FeedToken[]): FeedToken[] {
  const bySymbol = new Map<string, FeedToken>();
  for (const token of tokens) {
    const key = token.symbol.toUpperCase();
    const existing = bySymbol.get(key);
    if (!existing || (token.chainId === ARBITRUM_CHAIN_ID && existing.chainId !== ARBITRUM_CHAIN_ID)) {
      bySymbol.set(key, token);
    }
  }
  return [...bySymbol.values()].sort(
    (a, b) => priorityRank(a.symbol) - priorityRank(b.symbol),
  );
}

/** Fetch LI.FI tokens for feed chains, with 5-min client cache. */
export async function fetchLiFiTokens(force = false): Promise<FeedToken[]> {
  const now = Date.now();
  if (!force && cachedTokens && now - cachedAt < CACHE_TTL_MS) {
    return cachedTokens;
  }

  const response = await getTokens(lifiClient, {
    chains: [...FEED_CHAINS],
    chainTypes: [ChainType.EVM],
  });

  const flat: FeedToken[] = [];
  for (const chainTokens of Object.values(response.tokens)) {
    for (const token of chainTokens) {
      flat.push(tokenToFeedToken(token));
    }
  }

  cachedTokens = dedupeBySymbol(flat);
  cachedAt = now;
  return cachedTokens;
}

/** Resolve a product asset to its best-matching LI.FI token. */
export function findTokenForAsset(
  tokens: FeedToken[],
  asset: ProductAsset,
): FeedToken | undefined {
  for (const symbol of assetLookupSymbols(asset)) {
    const match = tokens.find((t) => t.symbol.toUpperCase() === symbol);
    if (match) return match;
  }
  return undefined;
}

/** Test helper — bust the client cache. */
export function resetLiFiTokenCacheForTests() {
  cachedTokens = null;
  cachedAt = 0;
}
