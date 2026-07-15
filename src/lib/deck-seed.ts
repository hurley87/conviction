// Desk-authored deck cards for demo / local mock (ADR 0016). Full anatomy —
// position, thesis, why-now, what-breaks-it, gate report — including one
// concrete TokenRef card. No chain names in user-facing thesis copy.

import type { ConvictionEntry } from "@/lib/verbs/types";

/** Trending Base token used in verb-layer tests and the TokenRef deck card. */
export const DECK_SURPLUS_TOKEN = {
  chainId: 8453,
  address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
  symbol: "SURPLUS",
} as const;

export const DECK_SEED_CARDS: ConvictionEntry[] = [
  {
    entryId: "deck-hero-eth-arb",
    handle: "davidbhurley",
    thesis:
      "ETH looks clean into the next leg — desk put on a small long and is publishing the receipt.",
    trade: {
      fromAsset: "cash",
      fromChain: "Base",
      toAsset: "eth",
      toChain: "Arbitrum",
      sizeUsd: 20,
    },
    createdAt: "2026-07-15T18:20:44.000Z",
    backedBy: [],
    receiptSlug: "deck-hero-eth-receipt",
    whyNow: [
      {
        at: "2026-07-14T12:00:00.000Z",
        event: "Open interest rebuilt after the flush without a liquidation cascade.",
      },
      {
        at: "2026-07-15T09:00:00.000Z",
        event: "Desk filled the entry; receipt timestamp precedes this card.",
      },
    ],
    whatBreaksIt:
      "A decisive break of the prior swing low with rising volume — we'd cut rather than average.",
    gateReport: [
      {
        name: "Liquidity depth",
        passed: true,
        evidenceUrl: "https://www.geckoterminal.com/",
      },
      {
        name: "Universal Account route",
        passed: true,
      },
      {
        name: "Desk position onchain before publish",
        passed: true,
      },
    ],
  },
  {
    entryId: "deck-token-surplus",
    handle: "davidbhurley",
    thesis:
      "SURPLUS is the name showing up in flow screens — small desk size, tight falsifier, published only after the route cleared.",
    trade: {
      fromAsset: "cash",
      fromChain: "Arbitrum",
      toAsset: "token",
      token: { ...DECK_SURPLUS_TOKEN },
      toChain: "Base",
      sizeUsd: 8,
    },
    createdAt: "2026-07-15T16:00:00.000Z",
    backedBy: [],
    receiptSlug: "deck-surplus-receipt",
    whyNow: [
      {
        at: "2026-07-15T10:00:00.000Z",
        event: "Trending on GeckoTerminal with stable depth through the morning.",
      },
      {
        at: "2026-07-15T14:30:00.000Z",
        event: "Warm-up route returned a live pair — card is backable.",
      },
    ],
    whatBreaksIt:
      "Liquidity collapse under $50k or a failed re-quote on the same size — both kill the thesis.",
    gateReport: [
      {
        name: "Liquidity depth",
        passed: true,
      },
      {
        name: "Contract verification",
        passed: true,
      },
      {
        name: "Universal Account route",
        passed: true,
      },
    ],
  },
  {
    entryId: "deck-btc-trim",
    handle: "hurley87",
    thesis:
      "Taking a slice of BTC back to cash after the bounce — not a macro call, just risk off the table.",
    trade: {
      fromAsset: "btc",
      fromChain: "Base",
      toAsset: "cash",
      toChain: "Arbitrum",
      sizeUsd: 15,
    },
    createdAt: "2026-07-14T20:00:00.000Z",
    backedBy: [],
    whyNow: [
      {
        at: "2026-07-14T08:00:00.000Z",
        event: "Bounce filled into prior supply; desk sized a trim.",
      },
    ],
    whatBreaksIt:
      "If spot reclaims the high with expanding volume, this trim was early — we'd re-enter smaller.",
    gateReport: [
      {
        name: "Universal Account route",
        passed: true,
      },
      {
        name: "Desk position onchain before publish",
        passed: true,
      },
    ],
  },
];
