# Particle Office Hours — Prep & Notes

Mid-hackathon office hours: technical questions, architecture feedback, troubleshooting across Universal Accounts, EIP-7702, and cross-chain UX.

Ask #1–#3 first — a bad answer to any of those forces a redesign. The five gating questions mirror `docs/adr/0000-particle-gating-questions.md`; capture answers here and fold outcomes back into the ADRs.

---

## Ask first (a "no" changes the build)

### 1. Solana support — biggest scope swing (ADR 0002)
> "On your network, can a Universal Account use **Solana as a source and destination** in a cross-chain trade? Does `getSmartAccountOptions()` return **both an EVM and a Solana deposit address that unify into one balance**? Mainnet-only or also testnet?"

Decides whether the headline is "SOL → USDC on Arbitrum" or an EVM-only fallback. If no, Solana is cut with no structural loss.

**Answer:**

### 2. Gas abstraction (ADR 0006)
> "Can UA pay transaction fees **out of the unified balance** (e.g. USDC) with **no native gas token**? If a 7702 user has zero native token anywhere, does their first trade still go through — or must I pre-fund native dust?"

The whole walletless/gasless UX (30% of Arbitrum's UX score) hinges on this. If no → fall back to invisible dust funding.

**Answer:**

### 3. Cross-chain receipt / verifiability (ADR 0013)
> "After a cross-chain move via `createUniversalTransaction`, what does the result expose — **per-chain tx hashes** (source *and* destination) for explorer links, or a single universal ID? If just an ID, what API resolves the underlying legs?"

This is how a judge verifies the bounty's cross-chain value move. Opaque ID → need the resolve-the-legs API or the proof falls apart.

**Answer:**

---

## Ask next (tuning, not redesign)

### 4. expectTokens semantics + latency (ADR 0011)
> "Does `expectTokens` enforce a **minimum-received** (worse-than-quoted fill aborts rather than completing)? Realistic **latency** for a convert like Base → USDC-on-Arbitrum?"

**Answer:**

### 5. Session keys in 7702 mode — Path A upside (ADR 0007)
> "Does UA support a **scoped session key on the user's own account in 7702 mode** — value cap, action allowlist, expiry, revocable? My understanding: a 7702 EOA holds only one delegation at a time, so a third-party session key can't be stacked — correct, or is there a supported pattern?"

Yes → upgrades agent permission from fund-isolation to cryptographic. No → confirms Path B is correct.

**Answer:**

---

## Funding / onramp (ADR 0015)

### 6. Does funding the EOA auto-reflect in the unified balance?
> "In 7702 mode the EOA address is the EVM Universal Account address — so if a fiat onramp (or anyone) deposits USDC straight to that EOA, does it **automatically appear in the unified balance** via `getPrimaryAssets()`, with no extra step?"

We use Privy's onramp, which deposits into the embedded EOA. Need a yes/no that this lands in the UA balance.

**Answer:**

### 7. Which onramp asset + chain lands as a Primary Asset?
> "Which **deliverable asset and chain** should a fiat onramp target so the deposit lands cleanly as a Primary Asset and unifies — e.g. USDC on Arbitrum?"

**Answer:**

---

## Architecture feedback (spare time)

- **Confirm the real SDK method names** (the PRD used placeholders): unified balance is **`getPrimaryAssets()`** → `totalAmountInUSD` (not `getUniversalBalance`); deposit addresses come from **`getSmartAccountOptions()`** (EVM + Solana) (not `getDepositAddresses`); cross-chain is **`createUniversalTransaction()` + `expectTokens`** (confirmed); withdrawals use **`createTransferTransaction()` → sign `rootHash` → `sendTransaction()`**.

- **Which exact chain/asset pairs have the most reliable UA liquidity right now?** (pick a spine pair that won't be flaky in the demo)
- **Is a mainnet small-funds demo more reliable than testnet for a cross-chain move, or is your testnet liquidity solid?** (validates ADR 0001; testnet-is-fine would de-risk us)
- **Recommended pattern for an agent-operated account?** (is "agent owns its own funded UA" — Path B — the right shape, or is there a blessed primitive?)
- **Any gotchas integrating Privy's `useSign7702Authorization` with the UA SDK?** (our reference signer, ADR 0004)

**Notes:**
