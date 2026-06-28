# Privy is the sole wallet provider; onboarding is Twitter social login only

> **Status: under reconsideration (2026-06).** Particle Network ships its own
> social login, and its docs state Universal Accounts can be created via social
> logins directly — so Particle Auth may be able to serve as the single
> provider, dropping Privy entirely and avoiding the Twitter-OAuth setup. The
> open question is whether Particle Auth can sign the EIP-7702 authorization as
> cleanly as Privy's `useSign7702Authorization`; notably, Particle's own 7702
> demo used Privy for exactly that step, which is a yellow flag. This is the
> top Particle office-hours question (see `docs/particle-office-hours.md`).
> Switching is cheap: Privy is isolated to `providers.tsx` + the account hook,
> and the verb layer / UA adapter are provider-agnostic. **Decision below stands
> until Particle confirms otherwise.**

Onboarding is **Twitter social login only**: one "Sign in with Twitter" tap mints an embedded EOA we 7702-upgrade in place. The embedded EOA's address is the Universal Account address; the embedded wallet signs the 7702 authorization programmatically from the session, so the upgrade is invisible (signed lazily on the first transaction per Particle's reference). The Twitter handle is the user's feed identity (ADR 0009) — identity, wallet, and 7702 from a single tap.

We **dropped the "connect existing wallet" (MetaMask) path**. The product is consumer-grade and walletless (vs. a pro terminal); a connect-your-wallet path dilutes that and adds a second flow to build and test. A crypto user with funds elsewhere is not locked out — they **deposit** to their new address (issue #3) rather than connecting. There is no bounty loss: minting a fresh embedded EOA and 7702-upgrading it still satisfies "an EOA upgraded in place via 7702." Funding a from-zero account is handled by the fiat onramp (ADR 0015) and deposits.

Decisive factor for the provider: **Particle's own official EIP-7702 demo signs the 7702 authorization via Privy's `useSign7702Authorization`.** Privy is therefore the reference-grade integration for the single most critical step (but see the reconsideration banner — Particle Auth may absorb this).

We considered **Magic**, which the hackathon features and which carries a **$500 Magic Labs bonus bounty** for the no-wallet path. Rejected as the provider because it is not Particle's reference 7702 integration, so adopting it would add risk on the exact signing path that gates the whole project. The $500 bonus is not worth that risk.

## Consequences
- Onboarding is one tap; there is no existing-wallet/MetaMask flow. Crypto users deposit to their new address.
- The Magic Labs $500 bonus bounty is deliberately forgone.
- There is exactly one auth surface and one signer-plumbing path into the UA SDK.
- The provider must do the *entire* onboarding — mint the embedded EOA **and** sign the 7702 authorization — which is precisely the open office-hours question for Particle Auth.
