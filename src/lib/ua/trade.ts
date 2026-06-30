// Shared trade payload builders for the UA adapter (issue #2).

import type { ProductAsset, TradeIntent } from "@/lib/verbs/types";
import { computeFloor, type RawTokenChanges } from "@/lib/verbs/quote";
import { ARBITRUM_CHAIN_ID } from "@/lib/verbs/chains";
import { toUaTokenType } from "@/lib/verbs/assets";

/** USDC has 6 decimals on Arbitrum. */
export function usdcAmountFromUsd(usd: number): string {
  return Math.floor(usd * 1e6).toString();
}

/** Estimate output before SDK quote (conservative fee assumption). */
export function estimateOutputUsd(sizeUsd: number): number {
  return sizeUsd * 0.995;
}

/** Build expectTokens floor payload for createUniversalTransaction (ADR 0011). */
export function buildExpectTokens(intent: TradeIntent, sizeUsd: number) {
  const floorUsd = computeFloor(estimateOutputUsd(sizeUsd));
  const tokenType = toUaTokenType(intent.toAsset);
  return {
    expectTokens: [{ type: tokenType, amount: usdcAmountFromUsd(floorUsd) }],
    chainId: ARBITRUM_CHAIN_ID,
  };
}

/** Trade config passed to UA SDK calls (ADR 0006 — gas abstraction). */
export function defaultTradeConfig(fromAsset?: ProductAsset) {
  const config: {
    universalGas?: boolean;
    usePrimaryTokens?: string[];
  } = { universalGas: true };
  if (fromAsset && fromAsset !== "cash") {
    config.usePrimaryTokens = [toUaTokenType(fromAsset)];
  }
  return config;
}

/** Minimal ITransaction shape used by signing helpers. */
export type RawTransaction = {
  transactionId?: string;
  rootHash?: string;
  userOps?: RawUserOpWithChain[];
  tokenChanges?: RawTokenChanges;
};

export type RawUserOpWithChain = {
  chainId: number;
  userOpHash?: string;
  userOp?: {
    eip7702Auth?: { chainId: number; nonce: number; address: string };
    eip7702Delegated?: boolean;
  };
  eip7702Auth?: { chainId: number; nonce: number; address: string };
  eip7702Delegated?: boolean;
};

/** Collect userOps needing a 7702 authorization signature. */
export function userOpsNeeding7702(
  userOps: RawUserOpWithChain[] | undefined,
): Array<{
  userOpHash: string;
  auth: { contractAddress: string; chainId: number; nonce: number };
}> {
  if (!userOps) return [];
  const pending: Array<{
    userOpHash: string;
    auth: { contractAddress: string; chainId: number; nonce: number };
  }> = [];

  for (const op of userOps) {
    const auth = op.eip7702Auth ?? op.userOp?.eip7702Auth;
    const delegated = op.eip7702Delegated ?? op.userOp?.eip7702Delegated;
    if (auth && !delegated && op.userOpHash) {
      pending.push({
        userOpHash: op.userOpHash,
        auth: {
          contractAddress: auth.address,
          chainId: auth.chainId,
          nonce: auth.nonce,
        },
      });
    }
  }
  return pending;
}
