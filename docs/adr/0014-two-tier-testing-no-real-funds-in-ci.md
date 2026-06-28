# Two-tier testing: mocked-SDK unit tier in CI, manually-gated real-funds spine smoke test

ADR 0001 made the integration target mainnet, so "integration test" now moves real money. We split testing into two tiers with a hard line between them:

1. **Mocked-SDK unit tier — CI, every push, deterministic, free.** The UA SDK sits behind the verb layer (our own seam), so we mock it. This tier owns quote shapes, intent parsing + clarify logic (ADR 0012), copy sizing math (ADR 0003), the min-received floor (ADR 0011), Path-B cap enforcement (ADR 0007), and — critically — a test where the **mocked SDK records the source chain and asserts `copyConviction` sourced from a *different* chain than the original settled on** (the differentiator, most likely to silently regress to a same-chain copy). The differentiator is fully protected with zero real funds.

2. **Real-funds spine smoke test — manually gated, never in CI, hard-capped tiny amount.** Exactly one deliberate run of the true spine (7702 upgrade → unified balance → one cross-chain trade → receipt resolves on both legs) against mainnet. This is the bounty-proving run.

We rejected keeping a **testnet integration tier** as a middle ground: thin/absent cross-chain liquidity on testnets is the exact reason ADR 0001 chose mainnet, so a testnet tier would give false confidence about the one step that matters.

## Consequences
- Real-money tests are never in CI (no funded key in CI secrets, no per-push spend, no flakiness).
- CI confidence comes from the mocked seam; bounty confidence comes from the one gated real run.
