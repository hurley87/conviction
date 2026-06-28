# The feed is seeded with real on-chain convictions, starting with one

Every conviction on the feed corresponds to a **real on-chain trade**. We seed the cold-start feed with **a single real conviction** (a real `executeTrade` + thesis) and add more incrementally as we run more trades. This supersedes the PRD's "3–5 personas + mock convictions" framing.

We rejected fabricated display-only originals (the option grilled earlier): an all-real feed means every entry has a verifiable receipt and the integrity story is unconditional — no "this persona isn't really trading" caveat. The mainnet cost objection (ADR 0001) is moot at one seed: a single small real trade, not three-to-five.

## Consequences
- The empty-feed failure mode is covered by one real entry, not a roster of personas.
- The cold-start render test asserts ≥1 real seeded conviction, not multiple personas.
- Adding personas later is incremental and optional, not required for the demo.
