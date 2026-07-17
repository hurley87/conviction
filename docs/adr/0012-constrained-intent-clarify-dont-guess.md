# Intent is a constrained schema; the concierge clarifies rather than guessing

Plain English becomes a trade through three guards, not one:

1. **Constrained intent schema.** The LLM maps text into a fixed shape — `{ fromAsset?, toAsset, sizeUsd | fraction, destChain (default Arbitrum) }` — never free-form calldata or amounts. The verb layer validates the intent against supported assets/chains and the user's *actual* balance before quoting, so a hallucinated asset or size is rejected, not executed.

2. **Clarify, don't guess.** When amount or asset is missing or unsupported, the concierge asks one plain-English follow-up ("How much — all of it, or a set amount?") instead of inferring. **It never silently infers "all."** Defaults are allowed only where safe and stated (destination = Arbitrum cash, per ADR 0005).

3. **Confirm card as backstop.** Because the user always sees "spend $25 → get ≈$24.95 in cash" before confirming (ADR 0011), a slightly misparsed intent is caught at consent. Parsing therefore must be *constrained + always surfaced*, not perfect.

ADR 0030 narrows the MCP surface further: MCP hosts submit structured intents directly, so the server validates or rejects fields but does not run the natural-language parser.

We rejected leaning on smart defaults to reduce back-and-forth: on a real-money app, a wrong inferred amount is the worst failure, and the cost of one clarifying question is trivial against it.

## Consequences
- The verb layer, not the LLM, owns validation against supported assets and live balance.
- Friendly NL is safe specifically because every intent passes through validation and an explicit confirm.
