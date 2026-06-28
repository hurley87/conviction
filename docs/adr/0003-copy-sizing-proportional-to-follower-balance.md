# "Back this" sizes the copy as a fraction of the follower's own balance

When a follower backs a conviction, the mirrored trade is sized as a **fixed percentage of the follower's unified balance** (default 10%, capped at the ADR-0001 mainnet ceiling) and copies the conviction's **direction** (fromAsset→toAsset), not its absolute USD size. The original's `sizeUsd` is display-only context, never the copy amount.

We rejected **same-notional copy** (move the same dollars the original did) because it fails whenever the follower has less than the original's size, and it makes risk wildly disproportionate across accounts. We rejected **same-fraction-as-the-original** because the feed entry doesn't carry the original trader's total balance, so their fraction isn't computable from feed data. Proportional-to-own-balance keeps the action genuinely one-tap, never errors on insufficient funds, and makes risk proportional per account.

## Consequences
- One tap uses the default %; an optional "advanced" affordance lets the follower override the amount.
- `ConvictionEntry.sizeUsd` is presentation only — do not read it as the copy amount.
