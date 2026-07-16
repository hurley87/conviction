"use client";

// Add-money sheet opened instead of sizing when unified balance is $0 (issue #26).
// Reuses issue #3 / ADR 0015 primitives: Privy onramp + deposit addresses.

import { AddMoneyButton } from "@/components/add-money-button";
import { GHOST_LIGHT } from "@/components/button-styles";
import { DepositAddress } from "@/components/deposit-address";
import type { DepositAddresses } from "@/lib/verbs/types";

export function AddMoneySheet({
  deposits,
  onAddMoney,
  isFunding,
  fundingError,
  onCancel,
}: {
  deposits: DepositAddresses | null;
  onAddMoney: () => void | Promise<void>;
  isFunding?: boolean;
  fundingError?: string | null;
  onCancel: () => void;
}) {
  return (
    <div className="w-full rounded-[26px] border border-line bg-surface p-5 text-left shadow-lg">
      <p className="pt-eyebrow">Add money</p>
      <p className="mt-3 text-sm text-ink-2">
        Add money to back this — we never show a percent of zero.
      </p>

      <div className="mt-5">
        <AddMoneyButton onAdd={onAddMoney} isFunding={isFunding} />
      </div>
      {fundingError && (
        <p className="mt-2 text-xs text-danger">{fundingError}</p>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <p className="pt-eyebrow mb-4">
          Or send crypto
        </p>
        {deposits ? (
          <DepositAddress deposits={deposits} />
        ) : (
          <p className="text-sm text-ink-4">Loading deposit addresses…</p>
        )}
      </div>

      <button
        type="button"
        onClick={onCancel}
        className={`${GHOST_LIGHT} mt-5 px-5 py-2 text-sm`}
      >
        Cancel
      </button>
    </div>
  );
}
