"use client";

// Signers-only live/mock split — same pattern as DeckBoard.

import { useAccount } from "@/components/account/account-context";
import { WithdrawalFlow } from "@/components/settings/withdrawal-flow";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { IS_LIVE } from "@/lib/env";
import { mockTradeSigners } from "@/lib/ua/mock";
import type { TradeSigners } from "@/lib/verbs/types";

type WithdrawalHostProps = {
  onClose: () => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

function WithdrawalBoard({
  signers,
  onClose,
  embedded,
  onBusyChange,
}: {
  signers: TradeSigners;
  onClose: () => void;
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const account = useAccount();

  return (
    <WithdrawalFlow
      ua={account.ua}
      signers={signers}
      ownerAddress={account.address}
      balance={account.balance}
      handle={account.handle}
      onSuccess={account.refreshBalance}
      onUpgraded={account.markUpgraded}
      onClose={onClose}
      embedded={embedded}
      onBusyChange={onBusyChange}
    />
  );
}

function LiveWithdrawalHost({
  onClose,
  embedded,
  onBusyChange,
}: WithdrawalHostProps) {
  const signers = useLiveTradeSigners();
  return (
    <WithdrawalBoard
      signers={signers}
      onClose={onClose}
      embedded={embedded}
      onBusyChange={onBusyChange}
    />
  );
}

export function WithdrawalHost({
  onClose,
  embedded,
  onBusyChange,
}: WithdrawalHostProps) {
  if (IS_LIVE) {
    return (
      <LiveWithdrawalHost
        onClose={onClose}
        embedded={embedded}
        onBusyChange={onBusyChange}
      />
    );
  }
  return (
    <WithdrawalBoard
      signers={mockTradeSigners}
      onClose={onClose}
      embedded={embedded}
      onBusyChange={onBusyChange}
    />
  );
}
