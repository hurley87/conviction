"use client";

// Live/mock signer host for the Settings withdrawal flow.

import { useAccount } from "@/components/account/account-context";
import { WithdrawalFlow } from "@/components/settings/withdrawal-flow";
import { useLiveTradeSigners } from "@/hooks/use-live-trade-signers";
import { IS_LIVE } from "@/lib/env";
import { mockTradeSigners } from "@/lib/ua/mock";

type WithdrawalHostProps = {
  onClose: () => void;
};

function LiveWithdrawalHost({ onClose }: WithdrawalHostProps) {
  const account = useAccount();
  const signers = useLiveTradeSigners();

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
    />
  );
}

function MockWithdrawalHost({ onClose }: WithdrawalHostProps) {
  const account = useAccount();

  return (
    <WithdrawalFlow
      ua={account.ua}
      signers={mockTradeSigners}
      ownerAddress={account.address}
      balance={account.balance}
      handle={account.handle}
      onSuccess={account.refreshBalance}
      onUpgraded={account.markUpgraded}
      onClose={onClose}
    />
  );
}

export function WithdrawalHost({ onClose }: WithdrawalHostProps) {
  if (IS_LIVE) {
    return <LiveWithdrawalHost onClose={onClose} />;
  }
  return <MockWithdrawalHost onClose={onClose} />;
}
