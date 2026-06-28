# Demo runs on mainnet with small real funds, not testnet-only

The PRD originally scoped the demo as testnet-only. We are reversing that: the demo and integration tests run on **mainnet with small real amounts**. Universal Accounts' cross-chain liquidity sourcing depends on real liquidity routes that are thin or absent on testnets, so a testnet demo is *more* likely to fail at the exact step the bounty cares about (a real cross-chain value move). Small real funds make the differentiating path reliably demonstrable. Trade-off accepted: real funds at risk, mitigated by keeping amounts tiny.

## Consequences
- "Mainnet deployment" must be removed from the PRD's Out of Scope list.
- Gas is now real — the "shield the user from gas" goal becomes a live requirement, not a testnet convenience.
- Safety bound: cap demo trade sizes to a small fixed ceiling.
