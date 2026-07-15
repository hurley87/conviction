// Pure quote shaping and min-received floor logic (ADR 0011).
// SDK-free so it is unit-testable without the UA client (ADR 0014).

import type { DestChain, TradeIntent, TradeQuote } from "@/lib/verbs/types";
import { chainName } from "@/lib/verbs/chains";

/** Default tolerance for the min-received floor (ADR 0011). */
export const DEFAULT_FLOOR_TOLERANCE = 0.01;

/** Minimal structural subset of SDK tokenChanges we depend on. */
export type RawTokenChanges = {
  totalDecrAmountInUSD?: string;
  totalIncrAmountInUSD?: string;
  totalFeeInUSD?: string;
  decr?: { token?: { chainId?: number } }[];
  incr?: { token?: { chainId?: number; symbol?: string } }[];
};

/** The token actually received, per the SDK's incr changes (e.g. "wstETH",
 * "WBTC", "USDC") — the ground truth for the receipt label. Undefined when the
 * SDK doesn't report a symbol (e.g. the mock), in which case callers fall back
 * to the product asset's canonical symbol. */
export function inferReceivedSymbol(
  changes: RawTokenChanges,
): string | undefined {
  return changes.incr?.[0]?.token?.symbol || undefined;
}

/** Compute the minimum-received floor from quoted output (ADR 0011). */
export function computeFloor(
  dollarsOut: number,
  tolerance = DEFAULT_FLOOR_TOLERANCE,
): number {
  return dollarsOut * (1 - tolerance);
}

/** True when a fresh quote would land below the agreed floor. */
export function isBelowFloor(freshOut: number, floorUsd: number): boolean {
  return freshOut < floorUsd;
}

export function parseUsd(value: string | undefined, fallback = 0): number {
  if (value == null || value === "") return fallback;
  // The UA SDK returns USD amounts as hex-encoded bignums scaled by 1e18
  // (e.g. "0x2c68af0bb13ffff" === $0.20). parseFloat would read these as 0,
  // which silently zeroed every fee and amount. Decimal strings (mock/tests)
  // are parsed directly.
  if (value.startsWith("0x")) {
    try {
      return Number(BigInt(value)) / 1e18;
    } catch {
      return fallback;
    }
  }
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Per-quote fee breakdown from the SDK's feeQuotes (IFeeTotals). */
export type RawFeeTotals = {
  feeTokenAmountInUSD?: string;
  gasFeeTokenAmountInUSD?: string;
  transactionFeeTokenAmountInUSD?: string;
  transactionServiceFeeTokenAmountInUSD?: string;
  transactionLPFeeTokenAmountInUSD?: string;
};
export type RawTxFees = {
  feeQuotes?: { fees?: { totals?: RawFeeTotals } }[];
};

/**
 * Pull the authoritative total fee (gas + LP + service) from the SDK
 * transaction's feeQuotes, or undefined if not present. Cross-chain fees are
 * roughly fixed, so this is what makes a tiny move's true cost visible.
 */
export function extractFeeUsd(rawTx: unknown): number | undefined {
  const totals = (rawTx as RawTxFees | null | undefined)?.feeQuotes?.[0]?.fees
    ?.totals;
  if (!totals) return undefined;
  const aggregate = parseUsd(totals.feeTokenAmountInUSD);
  if (aggregate > 0) return aggregate;
  const summed =
    parseUsd(totals.gasFeeTokenAmountInUSD) +
    parseUsd(totals.transactionFeeTokenAmountInUSD) +
    parseUsd(totals.transactionServiceFeeTokenAmountInUSD) +
    parseUsd(totals.transactionLPFeeTokenAmountInUSD);
  return summed > 0 ? summed : undefined;
}

/** Infer source chain from the SDK's decr token changes. */
export function inferSourceChain(changes: RawTokenChanges): string {
  const first = changes.decr?.[0]?.token?.chainId;
  return chainName(first);
}

/** Map SDK tokenChanges + intent into a jargon-free TradeQuote. */
export function shapeQuote(
  changes: RawTokenChanges,
  intent: TradeIntent,
  sizeUsd: number,
  transactionId: string,
  rawTransaction: unknown,
  etaSeconds = 45,
): TradeQuote {
  const dollarsIn = parseUsd(changes.totalDecrAmountInUSD, sizeUsd);
  const dollarsOut = parseUsd(
    changes.totalIncrAmountInUSD,
    dollarsIn * 0.995,
  );
  // Prefer the SDK's authoritative fee breakdown; fall back to the reported
  // total, then to the in/out delta — never silently show $0 when it cost money.
  let feeUsd = extractFeeUsd(rawTransaction);
  if (feeUsd == null) {
    const reported = parseUsd(changes.totalFeeInUSD);
    feeUsd = reported > 0 ? reported : Math.max(0, dollarsIn - dollarsOut);
  }
  const floorUsd = computeFloor(dollarsOut);

  return {
    dollarsIn,
    dollarsOut,
    feeUsd,
    etaSeconds,
    floorUsd,
    sourceChain: inferSourceChain(changes),
    destChain: intent.destChain as DestChain,
    toAsset: intent.toAsset,
    receivedSymbol: inferReceivedSymbol(changes) ?? intent.token?.symbol,
    transactionId,
    rawTransaction,
  };
}

/** Format seconds as a rough ETA string for the confirm card. */
export function formatEta(seconds: number): string {
  if (seconds < 60) return `about ${seconds} seconds`;
  const mins = Math.ceil(seconds / 60);
  return mins === 1 ? "about 1 minute" : `about ${mins} minutes`;
}
