# The receipt is the cross-chain verification artifact, not just user reassurance

The receipt does two jobs: it reassures the user, and it is **the artifact a judge uses to verify a real cross-chain value move via UA** (bounty requirement + stories 8 and 17). The second job is the stronger constraint and dictates the contents.

A UA `createUniversalTransaction` move can touch multiple chains. The receipt must make the cross-chain nature **self-evident**: at minimum a **source-chain leg and a destination-chain leg**, each as `{chain name, txHash, explorer link}`, plus a plain net summary ("$25 from Base → $24.95 USDC on Arbitrum"). It stays opt-in and post-trade — the only surface where chain names appear (no-vocabulary rule) — and is a **shareable permalink per trade/conviction** so a judge can open it directly. If UA returns only a single universal id, we map it to per-chain explorer links via UA's explorer/API rather than showing the opaque id alone.

## Status
Depends on a PRD open question. **Gating: confirm what `createUniversalTransaction` exposes in its result.** If it does not return per-chain tx hashes, the fallback is to read the legs from UA's transaction API — required to keep the move verifiable.

## Consequences
- A single opaque UA id is insufficient; the receipt must resolve to per-chain explorer links.
- The permalink makes the receipt usable as a submission/demo artifact, not just an in-app panel.
