"use client";

// Visible upgrade-in-place beat (issue #19). Same address before and after —
// no migration, now a Universal Account with one unified balance. No chain /
// EIP jargon (ADR 0013). Non-blocking: dismissible, never traps the flow.

import { formatUsd, truncateAddress } from "@/lib/format";
import { PRIMARY_LIGHT } from "@/components/button-styles";

export function UpgradeBeat({
  address,
  balanceUsd,
  onDismiss,
}: {
  address: string;
  balanceUsd: number | null;
  onDismiss: () => void;
}) {
  const short = truncateAddress(address);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="false"
      aria-labelledby="upgrade-beat-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          Your account
        </p>
        <h2
          id="upgrade-beat-title"
          className="mt-2 text-xl font-semibold tracking-tight text-zinc-900"
        >
          Upgraded in place
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          Same address as before — no new wallet, no migration. Your account is
          now a Universal Account with one balance to spend.
        </p>

        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Before
            </p>
            <p className="mt-1 font-mono text-sm text-zinc-800">{short}</p>
          </div>
          <span className="text-zinc-300" aria-hidden>
            →
          </span>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700/70">
              After
            </p>
            <p className="mt-1 font-mono text-sm text-emerald-900">{short}</p>
          </div>
        </div>

        {balanceUsd != null && (
          <p className="mt-4 text-center text-sm text-zinc-600">
            Unified balance{" "}
            <span className="font-semibold tabular-nums text-zinc-900">
              {formatUsd(balanceUsd)}
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className={`${PRIMARY_LIGHT} mt-6 w-full py-2.5 text-sm`}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
