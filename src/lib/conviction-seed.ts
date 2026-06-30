// Cold-start feed seed (ADR 0008): one real on-chain conviction so the feed is
// never empty. Replace SEED_CONVICTION with a genuine executed trade when
// available — same shape, swap the fields.

import type { ConvictionEntry } from "@/lib/verbs/types";

export const SEED_CONVICTION: ConvictionEntry = {
  entryId: "seed-hurley87-eth-cash",
  handle: "hurley87",
  thesis:
    "ETH looks strong into Q3 — moving a small slice to cash on Arbitrum while keeping exposure elsewhere.",
  trade: {
    fromAsset: "eth",
    fromChain: "Base",
    toAsset: "cash",
    toChain: "Arbitrum",
    sizeUsd: 25,
  },
  createdAt: "2026-06-28T18:00:00.000Z",
  backedBy: [],
  receiptSlug: "seed-receipt-hurley87",
};
