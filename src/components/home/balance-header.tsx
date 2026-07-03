"use client";

import { formatUsd } from "@/lib/format";

type BalanceHeaderProps = {
  totalUsd: number | null;
  loading?: boolean;
};

export function BalanceHeader({ totalUsd, loading }: BalanceHeaderProps) {
  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white bg-[radial-gradient(circle,theme(colors.zinc.100)_1px,transparent_1px)] bg-[length:16px_16px] px-8 py-10 text-center shadow-sm">
      <p className="text-5xl font-bold tabular-nums tracking-tight text-zinc-900">
        {loading || totalUsd == null ? (
          <span className="text-zinc-300">—</span>
        ) : (
          formatUsd(totalUsd)
        )}
      </p>
    </div>
  );
}
