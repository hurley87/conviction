# Particle gating questions (to confirm before/early in build)

A single checklist of capabilities our decisions depend on but that only Particle can confirm. Each is referenced by the ADR that hangs on it. If one comes back negative, the named fallback applies.

1. **Gas abstraction (ADR 0006).** Does UA pay transaction fees from the unified balance with **no native gas token required**? Fallback: invisibly pre-fund native dust onto the EOA during onboarding.

2. **Receipt exposure (ADR 0013).** Does `createUniversalTransaction` return **per-chain tx hashes** (or a UA-explorer link that resolves to them), so a cross-chain move is verifiable? Fallback: read the legs from UA's transaction API.

3. **Minimum-received floor (ADR 0011).** Does `expectTokens` support a **minimum-received** constraint that aborts on a stale/worse quote, and what is the convert latency for a cross-chain trade? Fallback: enforce the floor in the verb layer around the primitive.

4. **Solana support (ADR 0002).** Is **Solana usable as source/destination** via UA on our network, and does `getSmartAccountOptions()` return **both EVM and Solana deposit addresses that unify** into one balance? Fallback: EVM↔EVM spine only; Solana stays upside.

5. **Session keys in 7702 mode (ADR 0007 / Path A).** Does UA expose a **scoped session key on the user's own UA** in 7702 mode (value cap, action allowlist, expiry, revocable)? Note: a 7702 EOA holds only one delegation at a time, so third-party session keys can't be stacked. If unavailable, Path B (agent-owned funded UA) is the guaranteed model and Path A remains noted upside.
