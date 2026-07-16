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
    <div className="relative overflow-hidden rounded-[32px] border border-line bg-surface/90 px-6 py-10 text-center shadow-lg sm:px-10 sm:py-12">
      {/* Dawn/dusk gradient blobs — the hero's warm glow. */}
      <div
        className="pointer-events-none absolute -left-20 -top-28 h-[300px] w-[360px] rounded-full opacity-65 blur-[60px]"
        style={{ background: "var(--pt-grad-dawn)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-16 h-[280px] w-[340px] rounded-full opacity-30 blur-[64px]"
        style={{ background: "var(--pt-grad-dusk)" }}
        aria-hidden
      />

      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-success shadow-sm backdrop-blur sm:left-7 sm:top-7">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Live balance
      </div>

      <div className="relative flex flex-col items-center gap-3 pt-5">
        <span className="pt-eyebrow">Your portfolio</span>
        <p className="font-display text-[clamp(3.3rem,9vw,5.7rem)] font-medium leading-none tracking-[-0.055em] tabular-nums text-ink">
          {loading || totalUsd == null ? (
            <span className="text-ink-4">—</span>
          ) : (
            formatUsd(totalUsd)
          )}
        </p>
        <p className="max-w-md text-sm leading-relaxed text-ink-3">
          {subline ?? "Your unified balance across every chain, spendable as one."}
        </p>
      </div>
    </div>
  );
}
