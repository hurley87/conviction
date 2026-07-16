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
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-5 text-left">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">
        Add money
      </p>
      <p className="mt-3 text-sm text-zinc-600">
        Add money to back this — we never show a percent of zero.
      </p>

      <div className="mt-5">
        <AddMoneyButton onAdd={onAddMoney} isFunding={isFunding} />
      </div>
      {fundingError && (
        <p className="mt-2 text-xs text-red-500">{fundingError}</p>
      )}

      <div className="mt-6 border-t border-zinc-100 pt-5">
        <p className="mb-4 text-xs font-medium tracking-wider text-zinc-500 uppercase">
          Or send crypto
        </p>
        {deposits ? (
          <DepositAddress deposits={deposits} />
        ) : (
          <p className="text-sm text-zinc-400">Loading deposit addresses…</p>
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
