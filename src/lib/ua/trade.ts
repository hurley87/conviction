// Shared trade payload builders for the UA adapter (issue #2).

import type { ProductAsset, TradeIntent } from "@/lib/verbs/types";
import { DEFAULT_FLOOR_TOLERANCE, type RawTokenChanges } from "@/lib/verbs/quote";
import { destChainId, tokenAddress } from "@/lib/verbs/chains";
import { toUaTokenType } from "@/lib/verbs/assets";

/** Buy payload for createBuyTransaction — bounds the trade to amountInUSD so
 * the SDK doesn't sweep the whole balance (the empty-transactions bug). Settles
 * on the intent's chosen chain (see pickSettlementChain). */
export function buildBuyPayload(intent: TradeIntent, sizeUsd: number) {
  const chainId = destChainId(intent.destChain);
  const uaTokenType = toUaTokenType(intent.toAsset);
  const address = tokenAddress(uaTokenType, chainId);
  if (!address) {
    throw new Error(
      `No known ${uaTokenType} address on chain ${chainId} for this trade.`,
    );
  }
  return {
    token: { chainId, address },
    amountInUSD: sizeUsd.toFixed(2),
  };
}

/** A sell/convert: turning a specific held token (not cash) into the target.
 * The SDK rejects offloading a primary token via createBuyTransaction — these
 * must go through createConvertTransaction ("the Convert function"). */
export function isSellIntent(intent: TradeIntent): boolean {
  return intent.fromAsset != null && intent.fromAsset !== "cash";
}

/** Convert payload for createConvertTransaction — used to sell a primary token
 * (e.g. ETH) back to the destination (e.g. cash/USDC). `expectToken.amount` is
 * the sized dollar figure; for a stablecoin destination that's ~1:1 with token
 * units. The source token is directed via defaultTradeConfig(fromAsset)'s
 * usePrimaryTokens. */
export function buildConvertPayload(intent: TradeIntent, sizeUsd: number) {
  return {
    chainId: destChainId(intent.destChain),
    expectToken: {
      type: toUaTokenType(intent.toAsset),
      amount: sizeUsd.toFixed(2),
    },
  };
}

/** Trade config passed to UA SDK calls (ADR 0006 — gas abstraction; ADR 0011 —
 * the min-received floor is enforced at the SDK via slippageBps). */
export function defaultTradeConfig(fromAsset?: ProductAsset) {
  const config: {
    universalGas?: boolean;
    usePrimaryTokens?: string[];
    slippageBps?: number;
  } = {
    universalGas: true,
    slippageBps: Math.round(DEFAULT_FLOOR_TOLERANCE * 10_000),
  };
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
  feeQuotes?: unknown;
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
