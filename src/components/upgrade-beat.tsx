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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--pt-overlay)] p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="false"
      aria-labelledby="upgrade-beat-title"
    >
      <div className="w-full max-w-md rounded-[26px] border border-line bg-surface p-6 shadow-lg">
        <p className="pt-eyebrow">
          Your account
        </p>
        <h2
          id="upgrade-beat-title"
          className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink"
        >
          Upgraded in place
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Same address as before — no new wallet, no migration. Your account is
          now a Universal Account with one balance to spend.
        </p>

        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-[16px] border border-line bg-surface-2 px-3 py-3 text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-ink-4">
              Before
            </p>
            <p className="mt-1 font-mono text-sm text-ink">{short}</p>
          </div>
          <span className="text-ink-4" aria-hidden>
            →
          </span>
          <div className="rounded-[16px] border border-success/20 bg-[#edf6e9] px-3 py-3 text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-success/70">
              After
            </p>
            <p className="mt-1 font-mono text-sm text-success">{short}</p>
          </div>
        </div>

        {balanceUsd != null && (
          <p className="mt-4 text-center text-sm text-ink-2">
            Unified balance{" "}
            <span className="font-bold tabular-nums text-ink">
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
