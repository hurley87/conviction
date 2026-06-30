// Presentational unified-balance card. Shows one dollar figure — no chain,
// token, gas, or bridge vocabulary (the no-vocabulary UI rule). Chain/asset
// names live only in the opt-in receipt surface.

import { formatUsd } from "@/lib/format";

export function BalanceCard({
  totalUsd,
  loading,
}: {
  totalUsd: number | null;
  loading?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-10 py-8 text-center backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-[#6b7099]">
        Your money
      </p>
      <p className="mt-3 text-5xl font-bold tabular-nums text-white">
        {loading || totalUsd == null ? (
          <span className="text-[#4a4f74]">—</span>
        ) : (
          formatUsd(totalUsd)
        )}
      </p>
    </div>
  );
}
