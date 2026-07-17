# Build Guide — mirror Particle's 7702 demo

**Source of truth:** [`Particle-Network/universal-accounts-7702`](https://github.com/Particle-Network/universal-accounts-7702). We build Conviction by mirroring this demo's integration patterns, then layering our own product (social feed, no-vocabulary UI, MCP) on top. When in doubt about *how to call the SDK*, copy the demo.

## Locked decisions
- **Privy** is the wallet provider and 7702 signer (ADR 0004, decided) — exactly as the demo does. Particle Auth-only stays a possible later simplification, not a blocker.
- **Passwordless email OTP or X** login; no MetaMask path. Email must be enabled in the Privy dashboard for each deployment (ADR 0004).
- **LI.FI** is the token list + spot price + logo source (`getTokens()`), mirroring the demo. Charts (OHLC) would need a separate source later.
- Mainnet, small funds (ADR 0001); **Arbitrum** is the settlement chain (ADR 0005).

## What we copy vs. what we change
The demo is a **pro trading terminal** (token browser, swap/transfer/sell cards, wallet sidebar, tx list). We copy its **plumbing** but not its **surface**:
- **Copy:** Privy + 7702 auth handling, UA SDK init, `getPrimaryAssets`, LI.FI token/balance fetching, `createUniversalTransaction` + `expectTokens` transaction building.
- **Change:** no token-browser UI on the trade surface (we use a plain-English concierge + dollars-only confirm card, ADRs 0011/0012); tokens/charts live only in the **feed** (issue #4); we add the **conviction feed**, **cross-chain copy**, and **MCP** surfaces the demo has none of.

## Reference map — demo file → Conviction use → issue
| Demo file | What we lift | Issue |
|---|---|---|
| `lib/eip7702.ts` (`handleEIP7702Authorizations`) | The canonical pattern: iterate userOps, sign each `eip7702Auth` via Privy's `signAuthorization`, serialize with ethers `Signature.from`, cache by nonce | #2 (trade execution / first-tx upgrade) |
| Privy provider + `useSign7702Authorization` | Already mirrored in `providers.tsx` + `use-conviction-account.ts` | #1 ✅ |
| `lib/particle-balances.ts` (`particle_getTokens` RPC) + UA `getPrimaryAssets` | Unified balance + per-chain holdings | #1 ✅ (unified), #3 (deposits view) |
| `lib/lifi-tokens.ts` + `hooks/useLiFiTokens.ts` | Token list + price + logo, client-side, 5-min cached, priority-sorted | #4 (feed token display) |
| `lib/buy-transaction.ts` / `lib/sell-transaction.ts` / `lib/pay-with.ts` | `createUniversalTransaction` + `expectTokens` builders; "pay-with" = source-token selection | #2 (executeTrade), #5 (copyConviction) |
| `components/SwapCard.tsx`, `TransactionList`, `TransactionDetailDialog` | Tx flow + receipt UX reference (we restyle to no-vocab + our receipt, ADR 0013) | #2 |

## Key patterns to lift
1. **7702 authorization (issue #2).** The SDK returns userOps; for any with `eip7702Auth && !eip7702Delegated`, sign via Privy `signAuthorization({contractAddress, chainId, nonce}, {address})`, serialize, cache by nonce, attach to the userOp. This is the real "upgrade" — it happens at the first transaction, not at sign-in (see issue #1 notes).
2. **Cross-chain trade (issue #2/#5).** Build with `createUniversalTransaction` + `expectTokens` (declare target asset/amount; UA sources/converts from other chains). Add our min-received floor (ADR 0011) on top.
3. **Token list (issue #4).** `getTokens({ chains, chainTypes: [EVM] })` → cache 5 min → priority-sort. Drive the feed's asset display from this; never show a token LI.FI can't route.

## Env note
The demo uses `NEXT_PUBLIC_PROJECT_ID` / `NEXT_PUBLIC_CLIENT_KEY`; our `.env.local` uses `NEXT_PUBLIC_PARTICLE_PROJECT_ID` / `NEXT_PUBLIC_PARTICLE_CLIENT_KEY` (clearer). Keep ours; just map when copying demo code.

## Open threads (office hours, non-gating)
- Confirm LI.FI's list = UA's actual routable set (Q8).
- Gas-from-balance, Solana, receipt tx-hash exposure (ADR 0000) — still worth confirming, but the demo shows the happy path works.
