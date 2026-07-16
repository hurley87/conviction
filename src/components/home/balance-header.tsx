"use client";

import { formatUsd } from "@/lib/format";

type BalanceHeaderProps = {
  totalUsd: number | null;
  loading?: boolean;
  /** Optional momentum line, e.g. "backing 3 convictions". */
  subline?: string;
};

export function BalanceHeader({
  totalUsd,
  loading,
  subline,
}: BalanceHeaderProps) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-surface px-10 py-9 text-center shadow-[var(--pt-shadow-md)]">
      {/* Dawn/dusk gradient blobs — the hero's warm glow. */}
      <div
        className="pointer-events-none absolute -left-20 -top-28 h-[300px] w-[360px] rounded-full opacity-55 blur-[60px]"
        style={{ background: "var(--pt-grad-dawn)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-16 h-[280px] w-[340px] rounded-full opacity-30 blur-[64px]"
        style={{ background: "var(--pt-grad-dusk)" }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-2">
        <span className="pt-eyebrow">Your portfolio</span>
        <p className="font-display text-[52px] font-semibold leading-none tracking-tight tabular-nums text-ink">
          {loading || totalUsd == null ? (
            <span className="text-ink-4">—</span>
          ) : (
            formatUsd(totalUsd)
          )}
        </p>
        <p className="text-sm text-ink-3">
          {subline ?? "Your unified balance across every chain, spendable as one."}
        </p>
      </div>
    </div>
  );
}
