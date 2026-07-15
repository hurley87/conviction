"use client";

// Signers-only mock/live split — account state comes from AccountProvider
// (issue #22). Do not remount useConvictionAccount here.

import { DeckHome } from "@/components/deck/deck-home";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { IS_LIVE } from "@/lib/env";
import { mockTradeSigners } from "@/lib/ua/mock";
import type { ConvictionEntry } from "@/lib/verbs/types";

type DeckBoardProps = {
  cards: ConvictionEntry[];
};

function LiveDeckBoard({ cards }: DeckBoardProps) {
  const signers = useLiveTradeSigners();
  return <DeckHome cards={cards} signers={signers} />;
}

export function DeckBoard({ cards }: DeckBoardProps) {
  if (IS_LIVE) {
    return <LiveDeckBoard cards={cards} />;
  }
  return <DeckHome cards={cards} signers={mockTradeSigners} />;
}
