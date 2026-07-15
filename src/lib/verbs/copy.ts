// copyConviction verb — mirror a conviction's direction, sized to the backer's
// own unified balance (ADR 0003), sourcing cross-chain from wherever their
// funds sit (ADR 0002).

import type { UAClient } from "@/lib/ua/types";
import { validateIntent } from "@/lib/verbs/intent";
import { generateReceiptSlug } from "@/lib/verbs/receipt";
import {
  FloorAbortError,
  type ConvictionEntry,
  type ConvictionTrade,
  type Receipt,
  type TradeIntent,
  type TradeSigners,
  type UniversalBalance,
} from "@/lib/verbs/types";

/** Default fraction of the backer's unified balance for a one-tap copy (ADR 0003). */
export const DEFAULT_COPY_FRACTION = 0.1;

/** Mainnet safety ceiling for copy trades (ADR 0001). */
export const COPY_TRADE_CAP_USD = 25;

export type CopyConvictionDeps = {
  ua: UAClient;
  balance: UniversalBalance;
  signers: TradeSigners;
};

export type CopyConvictionResult = {
  receipt: Receipt;
  summary: string;
  sizeUsd: number;
  signed7702Auth?: boolean;
};

/** Size a copy trade: 10% of unified balance by default, capped at COPY_TRADE_CAP_USD. */
export function copyTradeSizeUsd(
  balance: UniversalBalance,
  override?: number,
): number {
  const cap = Math.min(balance.totalUsd, COPY_TRADE_CAP_USD);
  if (override != null) {
    return Math.min(Math.max(0, override), cap);
  }
  return Math.min(balance.totalUsd * DEFAULT_COPY_FRACTION, cap);
}

/** Build a trade intent that copies the conviction's direction, settling on the
 * original's chain so the back mirrors the published position. Funds still
 * source from wherever the backer holds them — a Base-funded back of an
 * Arbitrum-settled ETH card is the cross-chain money shot. A concrete-token
 * conviction re-targets the exact token (same address, same chain). */
export function copyIntent(trade: ConvictionTrade): TradeIntent {
  if (trade.token) {
    return {
      toAsset: "token",
      token: trade.token,
      destChain: trade.toChain,
    };
  }
  const intent: TradeIntent = {
    toAsset: trade.toAsset,
    destChain: trade.toChain,
  };
  if (trade.fromAsset !== "cash") {
    intent.fromAsset = trade.fromAsset;
  }
  return intent;
}

/** Execute a cross-chain copy of a conviction: quote → execute → receipt. */
export async function copyConviction(
  entry: ConvictionEntry,
  deps: CopyConvictionDeps,
  override?: number,
): Promise<CopyConvictionResult> {
  const { ua, balance, signers } = deps;
  const sizeUsd = copyTradeSizeUsd(balance, override);
  const intent = copyIntent(entry.trade);

  const validation = validateIntent({ ...intent, sizeUsd }, balance);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const quote = await ua.quoteTrade({
    intent: validation.intent,
    sizeUsd: validation.sizeUsd,
  });

  const receiptSlug = generateReceiptSlug();

  const execute = async (
    agreedQuote: typeof quote,
  ): Promise<CopyConvictionResult> => {
    const result = await ua.executeTrade({
      intent: validation.intent,
      sizeUsd: validation.sizeUsd,
      agreedQuote,
      signers,
      receiptSlug,
    });
    return {
      receipt: result.receipt,
      summary: result.summary,
      sizeUsd: validation.sizeUsd,
      signed7702Auth: result.signed7702Auth,
    };
  };

  try {
    return await execute(quote);
  } catch (e) {
    // A stale quote aborts at the floor; retry once with the fresh one.
    if (e instanceof FloorAbortError) {
      return execute(e.freshQuote);
    }
    throw e;
  }
}
