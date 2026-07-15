"use client";

// Client deck board with mock/live account split (issue #22).

import { useMemo } from "react";
import { useAccount } from "@/components/account/account-context";
import { DeckHome } from "@/components/deck/deck-home";
import { useConvictionAccount } from "@/hooks/use-conviction-account";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { IS_LIVE } from "@/lib/env";
import { getUAClient } from "@/lib/ua";
import { mockTradeSigners } from "@/lib/ua/mock";
import type { ConvictionEntry } from "@/lib/verbs/types";

type DeckBoardProps = {
  cards: ConvictionEntry[];
};

function MockDeckBoard({ cards }: DeckBoardProps) {
  const account = useAccount();

  return (
    <DeckHome
      cards={cards}
      ua={account.ua}
      balance={account.balance}
      signers={mockTradeSigners}
      handle={account.handle}
      onUpgraded={account.markUpgraded}
      onAddMoney={account.addMoney}
      isFunding={account.isFunding}
    />
  );
}

function LiveDeckBoard({ cards }: DeckBoardProps) {
  const account = useConvictionAccount();
  const shell = useAccount();
  const signers = useLiveTradeSigners();
  const ua = useMemo(
    () => (account.address ? getUAClient(account.address) : null),
    [account.address],
  );

  return (
    <DeckHome
      cards={cards}
      ua={ua}
      balance={account.balance}
      signers={signers}
      handle={account.handle}
      onSignIn={account.login}
      onUpgraded={shell.markUpgraded}
      onAddMoney={shell.addMoney}
      isFunding={shell.isFunding}
    />
  );
}

export function DeckBoard({ cards }: DeckBoardProps) {
  return IS_LIVE ? (
    <LiveDeckBoard cards={cards} />
  ) : (
    <MockDeckBoard cards={cards} />
  );
}
