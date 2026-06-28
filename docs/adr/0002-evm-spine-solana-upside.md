# EVM↔EVM (Arbitrum↔Base) is the guaranteed spine; Solana is upside

The headline demo was framed as SOL→USDC on Base, but Solana support via Universal Accounts is unconfirmed and was flagged as gating. We commit the **guaranteed spine to an EVM↔EVM cross-chain move (Arbitrum↔Base)**, which UA definitely supports and which fully satisfies the bounty (≥1 cross-chain value move via UA). **Solana is wired in as upside**: if `getSmartAccountOptions()` yields a working Solana deposit address that unifies, the headline becomes SOL→Base; if not, we fall back to the EVM pair with no narrative loss. This removes the single biggest project-sinking dependency from the critical path.

## Consequences
- The spine, verb layer, and `copyConviction` are all built and tested against the EVM pair first; Solana is an additive path, never a prerequisite.
