# EVM↔EVM (Arbitrum↔Base) is the guaranteed spine; Solana is upside

> **Update (2026-06-29): Solana inbound is confirmed on mainnet.** `getSmartAccountOptions()` returns a real `solanaSmartAccountAddress`, and a USDC-on-Solana deposit to it landed in the unified balance. So Solana-as-**source** works end-to-end — the SOL→Arbitrum headline is viable. The spine is still built EVM-first (Solana stays additive, never a prerequisite). Remaining unknowns: Solana as a *destination*, and the Solana custody/withdrawal model (Particle operates that address since the owner key can't sign ed25519) — see `docs/particle-office-hours.md` Q1b, with a mild bearing on the non-custodial framing.

The headline demo was framed as SOL→USDC on Base, but Solana support via Universal Accounts is unconfirmed and was flagged as gating. We commit the **guaranteed spine to an EVM↔EVM cross-chain move (Arbitrum↔Base)**, which UA definitely supports and which fully satisfies the bounty (≥1 cross-chain value move via UA). **Solana is wired in as upside**: if `getSmartAccountOptions()` yields a working Solana deposit address that unifies, the headline becomes SOL→Base; if not, we fall back to the EVM pair with no narrative loss. This removes the single biggest project-sinking dependency from the critical path.

## Consequences
- The spine, verb layer, and `copyConviction` are all built and tested against the EVM pair first; Solana is an additive path, never a prerequisite.
