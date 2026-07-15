// Considered pending state while a trade routes (issue #20). Shared by the
// concierge confirm card and conviction card backs. UA routing takes real
// seconds — narrate it honestly; never a bare spinner. No chain names
// (ADR 0013 — the receipt is the only place chains appear).

/** Shown between confirm/back and the receipt on both surfaces. */
export const ROUTING_PENDING_COPY =
  "Routing through your Universal Account…";

export function TradePendingStatus() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-3 text-sm leading-relaxed text-blue-900"
    >
      <p className="font-medium">{ROUTING_PENDING_COPY}</p>
      <p className="mt-1 text-xs text-blue-700/80">
        This can take a few seconds — hang tight.
      </p>
    </div>
  );
}
