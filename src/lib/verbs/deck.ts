// Deck policy helpers — which convictions surface as swipeable cards, and how
// right-swipe sizing maps fractions of unified balance to dollars (ADR 0016).

import { copyTradeSizeUsd } from "@/lib/verbs/copy";
import type { ConvictionEntry, UniversalBalance } from "@/lib/verbs/types";

/** Preset fractions on the sizing sheet (10% is the default — ADR 0003). */
export const DECK_SIZE_FRACTIONS = [0.05, 0.1, 0.25, 0.5, 1] as const;

export type DeckSizeFraction = (typeof DECK_SIZE_FRACTIONS)[number];

/** Deck inclusion policy: a gate report must be present (ADR 0016). */
export function isDeckCard(entry: ConvictionEntry): boolean {
  return Boolean(entry.gateReport && entry.gateReport.length > 0);
}

/** Newest drop first — deck order matches the feed archive. */
export function orderDeckCards(entries: ConvictionEntry[]): ConvictionEntry[] {
  return [...entries]
    .filter(isDeckCard)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

/** Dollar amount for a chosen fraction, capped like one-tap copy. */
export function sizeUsdForFraction(
  balance: UniversalBalance,
  fraction: number,
): number {
  if (fraction <= 0 || balance.totalUsd <= 0) return 0;
  return copyTradeSizeUsd(balance, balance.totalUsd * fraction);
}

/** Label for a fraction chip — dollars only, no chain vocabulary. */
export function fractionChipLabel(
  balance: UniversalBalance,
  fraction: number,
): { pct: string; usd: number } {
  const pct =
    fraction >= 1 ? "All" : `${Math.round(fraction * 100)}%`;
  return { pct, usd: sizeUsdForFraction(balance, fraction) };
}

/**
 * Right-swipe destination: funded → sizing; zero/unknown → add-money (issue #26).
 * Treat null balance as unfunded so sizing never opens at 10% × $0.
 */
export function backSwipeDestination(
  balance: UniversalBalance | null | undefined,
): "sizing" | "addMoney" {
  return balance != null && balance.totalUsd > 0 ? "sizing" : "addMoney";
}

/**
 * Pending-intent resume: while on add-money, return sizing for the same card
 * once funds arrive; otherwise stay put (null).
 */
export function resumeSizingAfterFunds(
  flowStatus: "addMoney" | string,
  entry: ConvictionEntry,
  balance: UniversalBalance | null | undefined,
  fraction: number,
): { status: "sizing"; entry: ConvictionEntry; fraction: number } | null {
  if (flowStatus !== "addMoney") return null;
  if (backSwipeDestination(balance) !== "sizing") return null;
  return { status: "sizing", entry, fraction };
}
