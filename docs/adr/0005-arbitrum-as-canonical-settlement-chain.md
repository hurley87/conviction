# Arbitrum is the canonical settlement / home chain

Refines ADR 0002. Within the EVM spine, **Arbitrum is the default destination**: the demo's canonical cross-chain move *lands on* Arbitrum (source from Base or Solana → settle to USDC on Arbitrum), `executeTrade` and `copyConviction` default their destination to Arbitrum unless the intent specifies otherwise, and the unified balance's "cash" leg is USDC-on-Arbitrum. Base and Solana are sources; Arbitrum is the settlement floor.

Driven by the Arbitrum "Road to Open House London" bounty, which requires the app to "run primarily on Arbitrum" with components on the Arbitrum network. Making value consistently settle on Arbitrum makes that claim literally true while preserving full chain-abstraction for the user (the no-vocabulary UI never surfaces the chain). A trade that *leaves* Arbitrum would tell the opposite story to those judges.

## Consequences
- The headline reframes from "into USDC on Base" to "into USDC" (settled on Arbitrum) — invisible to users, material to judges.
- Default-destination logic lives in the verb layer, so both surfaces inherit it.
