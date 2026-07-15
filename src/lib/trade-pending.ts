// Shared pending copy for trade execution (issue #20). UA routing takes real
// seconds — narrate it honestly; never a bare spinner. No chain names
// (ADR 0013 — the receipt is the only place chains appear).

/** Shown between confirm/back and the receipt on both concierge and card backs. */
export const ROUTING_PENDING_COPY =
  "Routing through your Universal Account…";
