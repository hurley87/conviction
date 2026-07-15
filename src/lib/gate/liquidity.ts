// Liquidity depth check via GeckoTerminal top pools for a token.

import type { GateCheck } from "@/lib/verbs/types";
import type { GateChainInfo } from "@/lib/gate/chains";

/** Default floor — below this, a back can move the market against followers. */
export const DEFAULT_MIN_LIQUIDITY_USD = 50_000;

export const LIQUIDITY_CHECK_NAME = "Liquidity depth";
export const LIQUIDITY_FAIL_DETAIL = "Liquidity is too thin to back safely";

export type LiquidityDeps = {
  fetch: typeof fetch;
  minLiquidityUsd?: number;
};

type GeckoPool = {
  attributes?: {
    reserve_in_usd?: string;
    address?: string;
  };
};

type GeckoPoolsResponse = {
  data?: GeckoPool[];
};

/** Sum reserve_in_usd across the first page of top pools for the token. */
export async function checkLiquidityDepth(
  address: string,
  chain: GateChainInfo,
  deps: LiquidityDeps,
): Promise<GateCheck> {
  const minUsd = deps.minLiquidityUsd ?? DEFAULT_MIN_LIQUIDITY_USD;
  const url =
    `https://api.geckoterminal.com/api/v2/networks/${chain.geckoNetwork}` +
    `/tokens/${address}/pools`;
  const evidenceUrl = chain.geckoTokenUrl(address);

  let totalUsd = 0;
  try {
    const res = await deps.fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return failLiquidity(evidenceUrl);
    }
    const body = (await res.json()) as GeckoPoolsResponse;
    for (const pool of body.data ?? []) {
      const reserve = Number.parseFloat(pool.attributes?.reserve_in_usd ?? "0");
      if (Number.isFinite(reserve)) totalUsd += reserve;
    }
  } catch {
    return failLiquidity(evidenceUrl);
  }

  if (totalUsd < minUsd) {
    return failLiquidity(evidenceUrl);
  }

  return {
    id: "liquidity",
    name: LIQUIDITY_CHECK_NAME,
    passed: true,
    evidenceUrl,
  };
}

function failLiquidity(evidenceUrl: string): GateCheck {
  return {
    id: "liquidity",
    name: LIQUIDITY_CHECK_NAME,
    passed: false,
    detail: LIQUIDITY_FAIL_DETAIL,
    evidenceUrl,
  };
}
