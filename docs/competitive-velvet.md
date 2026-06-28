# Competitive Analysis: Velvet Capital

Velvet and Conviction look adjacent ("AI + onchain trading") but target different users with different architectures. (Strategy note, not an architectural decision — see `docs/adr/` for those.)

Source: https://docs.velvet.capital/velvet-capital-ai-powered-onchain-trading-terminal/why-velvet

## At a glance

| Axis | Velvet Capital | Conviction |
|---|---|---|
| Core | AI trading *terminal* + portfolio/vault management | Chain-abstracted *social* trading |
| Chain abstraction | Omni-chain is aspirational/future ("aims to be first") | Now — UA 7702, one unified balance |
| Social / copy-trading | None | The wedge — convictions feed + cross-chain one-tap copy |
| AI | Velvet Unicorn: onchain+social insights, autonomous portfolio mgmt (mature) | Concierge (narrate/execute) + MCP for agents |
| Account model | Vault smart contracts, mint/burn LP tokens, multi-sig | EOA upgraded in place (7702), user is sole signer |
| Agent permissioning | Rich: whitelist wallets, restrict transfers/assets/protocols, admin role | Capability-scoping by verb surface + funded cap (ADR 0007) |
| Execution | Smart routing across AMM/DEX/OTC, MEV protection | UA universal-liquidity convert (no DEX/order book — out of scope) |
| Target user | Traders, portfolio managers, institutions (RWA beta) | Consumers/retail + AI agents |
| Custody | Non-custodial (vaults) | Non-custodial (7702 EOA) |

## Where Conviction genuinely wins

1. **Chain abstraction is real today.** Velvet's omni-chain is explicitly a future version; Conviction has it now via UA. A SOL/Base → Arbitrum move settling into one balance shows what they've only promised.
2. **Social copy-trading.** Velvet has no social layer. "Back a call from any chain" is a category they're not in — and single-chain incumbents (fomo) structurally can't match.
3. **Consumer-grade, walletless.** Velvet is a terminal for traders/PMs/institutions — vaults, LP tokens, multi-sig, admin roles. Conviction's jargon-free concierge + fiat onramp targets people Velvet doesn't serve.

## Where Velvet is ahead (be honest)

1. **Execution sophistication.** Smart routing + MEV protection is a real trading engine; Conviction deliberately scoped to "UA + simple convert" (no DEX/order book). Don't claim to out-trade them.
2. **AI maturity.** Autonomous portfolio management + onchain/social insight is deeper than a narration concierge. Conviction's AI story should be *access* (humans and agents on the same rails via MCP), not *alpha*.
3. **Agent permissioning.** Their vault permissioning (restrict transfers/assets/protocols) is essentially the cryptographic scoping Conviction punted to Path A. Frame Velvet as market validation that scoped agent permissions matter — and that Path A is the right direction to grow into.

## Strategic read

Conviction doesn't compete with Velvet — it's a consumer social product; they're a pro/institutional terminal. The real risk isn't them beating Conviction at its own game; it's them shipping omni-chain + a social layer and encroaching downward. The moat against that is the thing hardest to bolt onto a vault architecture: the social graph + cross-chain copy flywheel on a consumer-light 7702 account. Lean into that, not into trading sophistication.

**One-line positioning vs Velvet:** "Velvet is a Bloomberg terminal for onchain pros; Conviction is the social trading app your non-crypto friends can actually use — chain-abstracted today, with copy-trading that works no matter which chain anyone's money is on."
