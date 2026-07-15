# Build 1 — Hackathon

**Everything to build between now and submission. Nothing else.**
Track: Particle Universal Accounts (EIP-7702) · Bonus: Arbitrum ($2,000) · Judging: UX 40% / UA prominence 30% / adoption 20% / polish 10%

One sentence for the judges: **Swipe right on a real trader's position on any chain, and whatever balance you have on whatever chain becomes that position in one gesture — no bridge UI, no new address, no migration.**

---

## Step 1 — Prove the spine (issues #1–#5 closed; verify, don't rebuild)

The build guide's spine issues (#2 trade execution / first-tx 7702 auth, #3 deposits, #4 feed tokens, #5 `copyConviction`) are closed as of Jul 14. Closed ≠ green — the gate before demo work is proof, not construction:

- [ ] **The spine proof is a manual in-app run, not a script.** Run the real flow once in the deployed app with the desk wallet — 7702 upgrade → deposits from ≥2 chains unify → cross-chain trade — and record the **receipt permalink** as the artifact (ADR 0013: the receipt *is* the verification artifact). `scripts/smoke-spine.ts` is the pre-flight only (env + unified balance + quote shape + cross-chain check); it does not and should not execute — no demo-week time in the 10% category.
- [x] The cross-chain-copy test passes: `copyConviction` sources from a chain *different* from where the original settled (the in-repo PRD's named regression risk — the differentiator silently degrading to a same-chain copy). *(Verified Jul 14: `copy.test.ts` asserts source ≠ original settle chain; suite 105/105.)*
- [x] Min-received floor behavior confirmed (ADR 0011): a stale quote aborts and re-quotes rather than executing worse. *(Verified Jul 14: `FloorAbortError` + retry-once covered in `copy.test.ts`; floor math in `quote.ts`.)*

## Step 1.5 — Issue #7, the one open issue (stretch, after Step 2)

**#7 — Drive a Conviction account from Claude Desktop (MCP + Path B agent)** is the only open issue and triple-earns its place if time allows after the deck ships: it's the in-repo PRD's stage 4; it's the strongest incubation pitch in your own bounty notes ("UA as the wallet layer for AI agents" — an agent backing a conviction is a second, unmanned cross-chain op for the demo video); and it is literally the desk agent runtime — an MCP-driven Path B account posting through the verb layer is desk agent #1 minus the pipeline, so this work pre-pays Build 2. Sequence it strictly after Step 2: the 40% UX category is served by the deck, not by MCP. **Go/no-go is the video-first gate:** #7 starts only when the deck is deployed, every card is backed, and the demo video is recorded and watchable — with ≥48h left to submission. If #7 lands, re-record the video with the agent beat as a pure upgrade; if not, it ships as submission text only.

## Step 2 — The demo slice (desk-flavored, no pipeline)

1. **7702 upgrade made visible.** Same address before/after, now holding a unified balance. This moment is a judging beat — render it, don't just do it.
2. **Unified balance from ≥2 chains.** Small real USDC on Arbitrum + Base as one number. Chain names appear nowhere except the receipt (no-vocabulary rule).
3. **The deck: 3–5 hand-authored cards, full card anatomy** (position / thesis / why-now timeline / what-breaks-it / gate report). No pipeline behind them. **Every card** (gate-kill excepted) backed by a real small position ($5–10) from the funded desk wallet, entry timestamps onchain *before* card publication — the closing claim "every card is a revealed position" must stay judge-verifiable.
4. **One static gate-kill card.** "The token everyone's talking about, and the onchain reason we didn't touch it." Right-swipe works but opens the gate report (failed check + onchain evidence) instead of the sizing sheet — the attempted back *is* the beat; no dead gestures. Near-zero engineering, maximum differentiation from the bridge demos.
5. **Swipe verbs:** skip / save / back. Back opens the sizing sheet — preset *fractions* of unified balance (10% default per ADR 0003), dollars only. Zero-balance back routes to the add-money sheet (issue #3 onramp, ADR 0015) — "add money to back this" — then returns to sizing; never show 10% × $0. Save marks the card; saved cards live behind a "Saved" filter chip on the feed (no new surface).
6. **The money shot.** Hero card is **ETH settling on Arbitrum** — a plain v2 buy target that cannot fail the gate: the back sources from Base and settles *onto* Arbitrum (ADR 0005 — one move serving both the Particle requirement and the Arbitrum bounty). ARB itself is unbuyable — Particle's v2 router has no non-primary coverage on Arbitrum (verified 2026-07-14), which makes ARB the ideal **gate-kill candidate** ("no route through your account — the desk didn't touch it either"). A second beat: **one trending Base-token card** (any token via the SDK's warm-up flow) shows the deck isn't majors-only. Open the desk's ETH position as soon as the spine run is green. Receipt view resolves both legs with explorer links.
7. **Honest pending state.** UA routing takes real seconds — show it ("routing through your Universal Account…"), never a bare spinner. This is a 40%-category detail.

**Explicitly out (do not build thin versions):** the wire, verification pass, cohort priors, decision journal, brief/email, envelope, creator program, drop scheduling. They live in `after-hackathon.md`; reference them in the submission text only.

## Step 2.5 — Daily card workflow (pipeline v0 = a human and one script)

No research pipeline gets built this week; freshness comes from a morning routine, so the deck drops every day of the judging window:

1. **Candidates (~10 min):** GeckoTerminal trending + curated X list into a fixed Claude prompt ("apply the card template; draft theses; flag the falsifier").
2. **Gate (~5 min):** run `scripts/gate-check.ts` on each pick — **the one piece of pipeline code worth writing now.** Input: token address. Checks: liquidity depth (GeckoTerminal), contract verification + holder concentration (explorer API), **UA routability** (Particle's `warmUpToken` → `getTokenPair` router check — a listing requirement: an unbackable card in the demo is a demo-killing bug, so this check is mandatory even for hand-authored cards. Note: *all* non-primary tokens on Arbitrum fail it today — trending cards must be Base/Ethereum tokens). Output: the card's gate-report section. Triple-pays: card content now, a *real* gate-kill card (an actual failed check on an actually trending token), and the seed of `src/lib/gate/*` for Build 2.
3. **Author (~20 min):** edit drafts for voice; every claim reducible to a checkable fact.
4. **Position + post (~15 min):** open the small desk-wallet position (entry timestamp onchain *before* publication), post through the verb layer.

Payoff line for the video: "the deck has dropped every day of judging — scroll back." (The feed is the archive: swiped cards land there, newest drop first. An exhausted deck shows a "next drop tomorrow" end state pointing to feed + saved — never a blank screen.)

## Step 3 — Submission package

- [ ] Deployed app + documented local fallback run.
- [ ] Demo video following the script below.
- [ ] Submission text: one-liner, requirements mapping, desk PRD attached as vision appendix, explicit incubation pitch ("chain-abstracted social trading as a flagship UA consumer use case; same rails serve humans, house agents, and MCP-driven agents").

### Demo script (~3 min, ordered by judging weight)

1. Login with an existing EOA → it becomes a Universal Account in place — same address, no migration (≈20s).
2. **The absence tour (40% pitch):** one balance from two chains; no bridge screen, no network switcher, no gas token, no chain names. Say it: "the user is about to back a position on a chain they've never used, and the app will never mention it" (≈30s).
3. Flip the deck: real position with receipt, thesis with falsifier, the gate-kill card (≈50s).
4. Back the hero card: one right-swipe, sizing sheet in fractions, confirm (≈40s).
5. **The proof layer (30% pitch):** receipt — both legs onchain, Base → Arbitrum, entry timestamp preceding publication (≈25s).
6. Close on adoption (20%): "Every card is a revealed position, never a recommendation — the desk trades its own capital and publishes the receipts. This demo is Phase 1 of the attached PRD" (≈15s).

### Judging criteria map

| Criterion | Where we score |
|---|---|
| UX excellence (40%) | No-vocabulary UI end to end (ADRs 0011/0012); one-swipe cross-chain back; considered pending state; the absence tour |
| UA + 7702 prominence (30%) | Upgrade-in-place shown in UI; cross-chain back as the core verb, not a feature; two-leg receipt (ADR 0013) |
| Adoption potential (20%) | Desk PRD appendix; business-model doc (take rate + copy-fee split); MCP/agent surface |
| Technical quality (10%) | Verb-layer tests, CI, smoke script — already exists; spend no more demo-week time here |

### Judging notes

- The track will be dense with bridge UIs and payment flows. Conviction's cross-chain operation has a *reason* — copying a revealed position — and a personality. Lead with the story, land on the SDK.
- The two frames where UA itself is the star: upgrade-in-place and the two-leg receipt. Give each its own beat in the video.
- Incubation lens, stated plainly: the demo proves the spine works; the attached PRD proves there's a company on top of it.
