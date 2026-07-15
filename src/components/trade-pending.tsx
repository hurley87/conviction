// Considered pending state while a trade routes (issue #20). Shared by the
// concierge confirm card and conviction card backs.

import { ROUTING_PENDING_COPY } from "@/lib/trade-pending";

export function TradePendingStatus({
  label = ROUTING_PENDING_COPY,
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-3 text-sm leading-relaxed text-blue-900"
    >
      <p className="font-medium">{label}</p>
      <p className="mt-1 text-xs text-blue-700/80">
        This can take a few seconds — hang tight.
      </p>
    </div>
  );
}
