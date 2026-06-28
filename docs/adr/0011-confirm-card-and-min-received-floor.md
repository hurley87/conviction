# Plain-English confirm card with mandatory human confirm, backed by a minimum-received floor

**Consent (a).** Before any human trade executes, the concierge shows a plain-English confirm card: what you're spending (`$25`) → what you'll end up with (`≈$24.95 in cash`), the **fee** folded in and labeled "fee" (never "gas"), and a rough ETA. One confirm button. Chain/asset/jargon never appear here — the opt-in receipt is the only place chains and explorer links show. **Humans confirm every trade explicitly; there is no auto-execute.** The agent/MCP path is the only one without a human confirm — there the funded cap (ADR 0007) replaces consent.

**Quote staleness (b).** Prices move between quote and execute. We bind consent to a floor: `executeTrade` passes a **minimum-received** into UA's `expectTokens`, set to the quoted output minus a **1% default tolerance**. If execution would land below the floor, the trade **aborts and re-quotes + re-confirms** rather than completing a materially worse deal. This makes the chain-level primitive enforce the promise the UI made, so the narrated result can never diverge from what the user agreed to.

We rejected a "just do it" auto-confirm for humans (silent real-money moves destroy trust) and silently executing whatever the quote returns (narration would not match consent).

## Consequences
- The 1% tolerance is correct for a USDC destination (ADR 0005). A future volatile destination asset would need a wider tolerance.
- The confirm card and the receipt are distinct surfaces: jargon-free consent vs. opt-in proof.
