# PRD: Conviction — Chain-Abstracted Social Trading

> Source plan: [conviction-ua-7702-idea.md](conviction-ua-7702-idea.md) · Bounty: [Particle UA EIP-7702](particle-universal-accounts-7702-bounty.md)
> Status: ready for build · Target: UXmaxx Hackathon (Particle Network Universal Accounts, EIP-7702 mode)

---

## Problem Statement

A user holds assets scattered across multiple chains — some SOL on Solana, some USDC/ETH on Base, dust on Arbitrum. To do anything useful with that money as a whole, they have to think in terms of chains: bridge between them, switch networks, hold a separate gas token on each, and track separate balances. This friction is the everyday tax of multichain ownership, and it's the reason most people never touch assets outside one ecosystem.

It gets worse socially. When someone makes a trade they believe in, there's no good way to share *the trade plus the reasoning* and let others act on it — and existing social-trading apps are locked to a single chain (e.g. Solana-only), so a follower can only copy a call if their money already lives on the same chain. And as AI agents start to act on users' behalf, there's no safe, scoped way to let an agent trade across chains without handing over keys.

The user shouldn't have to know or care which chain anything is on.

## Solution

Conviction turns the wallet a user already has into a chain-abstracted **Universal Account** using Particle Network's Universal Accounts SDK in **EIP-7702 mode** — the existing EOA is upgraded in place (same address, no migration, no new account). The user's holdings across Solana, Base, and Arbitrum collapse into a single **unified balance** they can trade from in one place, with no bridging or network switching.

Every trade can be published as a **conviction**: the trade plus a short thesis, posted to a public feed. Other users read the reasoning and **back the call in one tap** — and because it runs on Universal Accounts, they can back a Solana→Base trade even if their own money is entirely on Arbitrum. The funds are sourced and converted from wherever their balance lives. This is the core differentiator: **copy-trading without a shared chain.**

Conviction is **two surfaces over one engine**. A consumer app serves humans through an AI concierge that trades and narrates in plain English. An **MCP server** exposes the same actions to AI agents, so a permissioned agent can trade and post convictions on the same feed as humans — **agent social trading** — under a scoped, revocable permission.

## User Stories

1. As a person with an existing EVM wallet, I want to sign in and upgrade it in place, so that I get a chain-abstracted account without creating a new address or migrating assets.
2. As a person with no crypto wallet at all, I want to sign in with a social login, so that an account is created and upgraded for me invisibly and I can still participate.
3. As a user who holds assets on multiple chains, I want to see a single combined balance, so that I never have to think about which chain my money is on.
4. As a Solana holder, I want a deposit address for my SOL/USDC, so that my Solana assets join the same unified balance as my EVM assets.
5. As a trader, I want to express a trade in plain English ("move my SOL into USDC on Base"), so that I can act without choosing networks, bridges, or gas tokens.
6. As a trader, I want the cross-chain trade to execute by sourcing from wherever my funds live, so that I never manually bridge or hold wrapped assets.
7. As a trader, I want the agent to narrate what it did across chains in plain English, so that I understand and trust the move.
8. As a user, I want to see a verifiable receipt (explorer links across chains) on demand, so that I can confirm the value really moved.
9. As a user who just made a trade, I want to post it as a conviction with a short thesis, so that others can see what I did and why.
10. As a feed reader, I want to browse convictions by handle with their reasoning, so that I can decide whose calls to back.
11. As a follower, I want to back a conviction in one tap, so that the same trade is mirrored for me, sized to my balance.
12. As a follower whose money is on a different chain than the original trade, I want to back it anyway, so that I'm not blocked by where my assets happen to sit.
13. As a user, I want to ask the concierge to summarize or sanity-check the feed, so that I get a plain-English read without parsing every post.
14. As a user, I want to grant an AI agent a scoped, revocable permission (capped amount, allowed actions, no withdrawals), so that it can trade for me without custody of my funds.
15. As a developer/agent operator, I want to drive a Conviction account through an MCP server, so that any MCP host (e.g. Claude Desktop) can check balances, trade cross-chain, and post or back convictions.
16. As a user, I want to revoke an agent's permission at any time, so that I stay in control.
17. As a judge/evaluator, I want a runnable demo that performs a real cross-chain value move via UA, so that I can verify the project meets the bounty requirements.

## Implementation Decisions

**Account & identity model**
- The account is a Particle **Universal Account** initialized in **EIP-7702 mode** (`useEIP7702: true`). The user's EVM EOA is the **sole signer**; it is upgraded in place via a one-time EIP-7702 authorization signature (per chain). No co-signer.
- Two deposit addresses are exposed via the SDK's account-options call: an **EVM address** (the upgraded EOA itself; covers Base + Arbitrum) and a **UA-derived Solana address**. Deposits to either unify into one balance. Bringing Solana assets in is a **deposit** (send from an external Solana wallet to the UA Solana address), not a wallet-link; the EVM EOA remains the only signer.
- **No-wallet onboarding:** a social-login embedded EVM EOA (via an embedded-wallet provider — Privy/Dynamic/Magic) is minted and then 7702-upgraded. Same downstream account model.
- Network: **testnet** for the demo.

**The verb layer (single core; both surfaces wrap it)**
All product actions are expressed as a small set of chain-agnostic verbs. Each returns structured state; callers never see calldata or addresses. This is the contract both the in-app concierge and the MCP server depend on:

```
getUniversalBalance() -> { totalUsd, sources: [{ chain, asset, usd }] }
getDepositAddresses() -> { evm, solana }
quoteTrade(intent)    -> { plan, sourceChain, destAsset, destChain, plainEnglish }
executeTrade(intent)  -> { done, receipts: [{ chain, txHash }], summary }
postConviction(trade, thesis) -> { entryId }
copyConviction(entryId)       -> { done, receipts: [{ chain, txHash }] }
summarizeFeed()       -> { digest, flagged: [entryId] }
```

- The **cross-chain operation** is implemented with the SDK's `createUniversalTransaction` using `expectTokens` to declare the target asset/chain; UA's universal liquidity sources and converts from other chains automatically. `executeTrade` and `copyConviction` both route through this primitive.
- `copyConviction` sizes the mirrored trade to the caller's balance and **must source from the caller's funds regardless of which chain they sit on** — this is the differentiating path and is treated as a first-class operation, not a special case.

**Conviction feed**
- A conviction entry is the decision-carrying record shared on the feed:

```
ConvictionEntry {
  entryId
  handle
  thesis            // short free text — the "why"
  trade: { fromAsset, fromChain, toAsset, toChain, sizeUsd }
  createdAt
  backedBy: [handle]   // who copied it
}
```

- Storage is a **lightweight store** (serverless KV or small DB). The feed is **seeded with 3–5 personas + real testnet convictions** so it is never empty.

**Two surfaces**
- **In-app concierge:** an LLM (Claude) with a jargon-free advisor persona calls the verbs server-side; loop is understand → quote → user confirms → execute → narrate → offer to post.
- **MCP server:** the same verbs exposed as MCP tools, so an external MCP host can operate a Conviction account. The host is the UI; humans and agents post/back on the same feed.

**Agent permission model (decision: build Path B, treat Path A as upside)**
- **Path B (default, guaranteed):** an agent operates **its own** Universal Account, which the user funds with a **capped amount**. "Permission" = the funded cap; "revoke" = stop funding / withdraw. Depends on nothing unconfirmed.
- **Path A (upside, unconfirmed):** a **scoped session key** on the *user's own* UA (value cap, action allowlist excluding external withdrawal, expiry, revocable) — the canonical EIP-7702 + session-key pattern. **Blocked unless Particle's UA implementation exposes session keys**, because a 7702 EOA can hold only one delegation at a time (so third-party delegator session keys cannot be stacked on a UA). Confirm with Particle before relying on it.

**No-crypto-vocabulary UI**
- The main UI never says bridge, gas, sign, wrapped, chain, or token. Chain/asset names appear only in an opt-in "receipt" surface.

## Testing Decisions

- **Protect the spine end-to-end first.** The highest-value test asserts the full protected path on testnet: 7702 upgrade → unified balance reflects deposits from ≥2 chains → one cross-chain trade executes via UA → receipts resolve on both source and destination explorers. If this passes, the project meets the bounty's core requirement.
- **Test the verb layer in isolation.** The verbs are the seam: the UA SDK lives behind them, so they can be exercised with the SDK mocked for fast unit coverage (quote shapes, intent parsing, sizing math) and against testnet for integration coverage.
- **Dedicated test for the cross-chain-copy wedge.** Assert that `copyConviction` sources funds from a chain *different* from where the original trade settled — this is the differentiator and the most likely thing to silently regress to a same-chain copy.
- **Permission scoping (Path B).** Assert the agent's funded cap is enforced (an over-cap trade fails), that the agent cannot move funds to an external address, and that revocation halts further agent action.
- **Feed seeding.** Assert the feed renders with seeded personas on a cold start (empty-feed states are a known failure mode for this product category).
- The agent/concierge loop is fully mockable; tests should not depend on live LLM output for deterministic assertions.

## Out of Scope

- A full DEX or order book. UA + a simple convert is the trading surface; no matching engine, limit orders, or routing UI.
- A real social network: follows, reputation, verified P&L, anti-gaming, leaderboards. The feed is seeded and read-mostly for v1.
- Autonomous background/recurring trading and rebalancing.
- A permission marketplace or full session-key management UI (Path A's rich controls). One scoped permission + cap + revoke is enough to demonstrate the concept.
- Mainnet deployment; the demo is testnet-only.
- Robinhood Chain and any chain not supported by Universal Accounts.
- X/Twitter write API or auto-posting.
- Solana-wallet-as-signer account model (incompatible with EVM 7702 mode).

## Further Notes

**Bounty alignment.** Meets all three Particle requirements: UA SDK in EIP-7702 mode; ≥1 cross-chain value move via UA (the trade, a human copy, and an agent copy each qualify); runnable/deployed demo. Including Arbitrum keeps the project eligible for the Arbitrum "Road to Open House London" bounty; using an embedded-wallet provider for no-wallet onboarding could qualify for the Magic Labs bounty. The MCP/agent angle ("Universal Accounts as the wallet layer for AI agents") is the strongest incubation pitch.

**Build order (each stage is independently submittable; risk decreases monotonically).**
1. Spine — 7702 upgrade → unified balance → one cross-chain trade via UA (verb layer underneath).
2. Consumer app — in-app concierge over the verbs.
3. Conviction Feed — post + cross-chain copy, seeded.
4. MCP + permissions — wrap verbs as MCP server + Path B agent account.
5. Polish + pitch.

**Open questions to resolve with Particle early (gating).**
- #1: Does the UA implementation expose scoped session keys on the user's account in 7702 mode? (Gates Path A.)
- Solana usable as source/destination on testnet alongside Base, and the exact testnet pair to use.
- Confirm `getSmartAccountOptions()` returns both EVM and Solana deposit addresses and they unify on testnet.
- Latency/failure modes of `createUniversalTransaction` + `expectTokens` for a SOL→(USDC on Base) convert, and what the receipt exposes.
- Whether the user can be shielded from gas (paid in any token / sponsored).

**Domain vocabulary (use consistently).**
- *Universal Account (UA)* — the chain-abstracted account; in 7702 mode it is the user's upgraded EOA.
- *Unified balance* — the user's assets across all chains shown and spendable as one number.
- *Conviction* — a posted trade + thesis on the feed.
- *Back this / copy* — mirroring a conviction's trade, sourced cross-chain from the copier's balance.
- *Verb layer* — the shared set of product actions both surfaces call.
- *Receipt* — the opt-in proof surface showing chains + explorer links.
- *Path A / Path B* — the two agent-permission strategies (native session keys vs. agent-owned funded UA).
