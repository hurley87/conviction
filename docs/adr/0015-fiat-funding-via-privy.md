# Fiat funding uses Privy's native onramp; funds land in the EOA = the UA

Users can top up from fiat without an exchange. We use **Privy's** native funding (not Particle's onramp), because the deciding factor is *where the money lands*: the Privy embedded wallet **is** the EOA, and in 7702 mode that EOA address **is** the EVM Universal Account address — so a Privy onramp deposits straight into the EOA and appears in the unified balance with no extra plumbing. Privy is already the auth + signer SDK (ADR 0004), so this is one vendor, one SDK.

We rejected **Particle's onramp**: it would be a second integration and mostly assumes Particle's hosted wallet UI, which we are not using (UA is driven headlessly).

**Demo vs production paths:**
- **Demo: card / Apple Pay / Google Pay** (via MoonPay or Coinbase Onramp). Lightest — no KYC setup, no Bridge keys.
- **Production: bank account** (`useFundWalletWithBankDeposit`, ACH/wire/SEPA). Heavier — requires Bridge API keys and a KYC flow, too much friction for the demo.

## Constraints
- **Mainnet-only.** Onramps deliver mainnet assets, so fiat funding can't work on testnet — this reinforces ADR 0001.
- **Deliverable asset/chain matters.** The onramp must deliver a supported **Primary Asset** (e.g. USDC) on a chain UA unifies (e.g. Arbitrum), or the deposit won't join the unified balance.

## Open (confirm with Particle)
- Does funding the EOA auto-reflect in the UA unified balance (assumed yes via EOA == UA EVM address in 7702)?
- Which onramp deliverable asset+chain lands cleanly as a Primary Asset?
