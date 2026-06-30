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
  incr?: { token?: { chainId?: number } }[];
};

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
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
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
  const feeUsd = parseUsd(changes.totalFeeInUSD, Math.max(0, dollarsIn - dollarsOut));
  const floorUsd = computeFloor(dollarsOut);

  return {
    dollarsIn,
    dollarsOut,
    feeUsd,
    etaSeconds,
    floorUsd,
    sourceChain: inferSourceChain(changes),
    destChain: intent.destChain as DestChain,
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
