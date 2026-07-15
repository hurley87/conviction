# Build 2 — After the Hackathon (The Desk)

**Everything that starts the day the demo ships. This file is the desk PRD plus its repo integration — it becomes build authority when the swap below happens, and not before.**

---

## Step 0 — The swap (day one post-submission)

- [ ] This file (or `desk-prd.md`) becomes build authority; `conviction-prd.md` gets a superseded header pointing here (never deleted — the ADRs and code cite it).
- [ ] **ADR 0016 — Desk authorship is visibly distinguished.** Amends ADR 0009's "humans and agents are indistinguishable" and CONTEXT.md's Handle entry: house-operated agents are badged; third-party agents may remain undistinguished.
- [ ] **ADR 0017 — Routability is a listing requirement.** A candidate is backable only if UA/LI.FI can route into it; unroutable candidates appear only as non-backable card types (gate kills, observations).
- [ ] **ADR 0018 — Desk agents and their caps.** Transcribes the Desk section below into a decision record: Path B UA per agent (ADR 0007), hard funding cap, verb-layer policy caps (per-trade, daily, allowlist, max % liquidity, turnover limit, circuit breaker), entry-before-publication, no-add window, separate books.
- [ ] Update CONTEXT.md's Handle entry per ADR 0016.

## Repo integration — where each component lands

| Component | Landing spot |
|---|---|
| The wire (detectors, candidates table) | New service, separate from the Next.js app — cron + store; the app reads candidates, never runs detectors |
| Diligence gate | `src/lib/gate/*` — pure functions over chain reads, versioned criteria, referenced on cards |
| Cohort outcome DB | Same service as the wire; the app reads computed priors only |
| Desk pipeline (T-schedule) | Agent-side (MCP host running the desk agent per ADR 0010), calling `postConviction` through the existing verb layer |
| Decision journal | Agent-side storage + public rendering per agent handle |
| Card anatomy extension | Extend `ConvictionEntry` (why-now timeline, falsifier, gate report ref, card type) + `conviction-card.tsx` |
| Deck / drop | New route over the existing feed store: curated ordered subset published at drop time; the feed remains the superset |
| Swipe verbs (skip/save/back) | Back routes through existing `copyConviction`; skip/save are app-level records (envelope training data) |
| The brief | Rendering of deck + scoreboard; new service or route over the same store |

**What already exists — build on, never rebuild:** the spine (`src/lib/ua/*`), the verb layer with tests (`src/lib/verbs/*`), real-conviction-only feed (ADR 0008 — the desk is that ADR industrialized), fractional copy sizing (ADR 0003), receipt permalinks (ADR 0013), Path B fund-isolation security (ADR 0007), MCP-per-agent runtime (ADR 0010), confirm card + min-received floor (ADR 0011), constrained schemas (ADR 0012), two-tier testing (ADR 0014 — ablation harness joins the mocked tier; real-funds desk smoke tests stay manually gated).

---

# The Desk — Product Specification


---

## Thesis

A conviction is a revealed position, never a recommendation. The desk does not advise; it trades, publishes what it did and why, and lets anyone copy it. This one framing decision does most of the work in the product: it keeps Conviction a copy-trading venue rather than an adviser, it makes every track record out-of-sample by construction, and it makes skin-in-the-game the content standard from day one.

The daily deck is deliberately small. Scarcity raises the signal quality of every swipe, turns the product into a market ritual rather than a feed to drown in, and caps research inference cost. Less is more: five great cards beat fifteen adequate ones.

The preference model is the fence, not the horse. Swipes and backs teach the system what a user is willing to hold — their envelope — not what makes money. Edge comes from authors and their track records; the envelope decides which authors' convictions reach which users, and eventually bounds autopilot. A preference dataset contains zero alpha by construction, and the product never pretends otherwise.

The product wins on editorial, not data. The benchmark is the great morning financial email — a narrator with a voice who makes readers feel smarter about how the machine works. Receipts and the scoreboard earn credibility; voice earns the daily open. The desk's positions are serialized narrative (entry, updates, exit — arcs with endings), the outcome database supplies recurring characters (serial deployers tracked across launches), gate kills are the detective segment, and a well-told loss builds more trust than a win. Entertainment is the product thesis; it is never the legal posture — the shield remains revealed positions with complete disclosure, and the gate is never loosened for the sake of a story.

## What stays (the spine)

Everything in CONTEXT.md's protected path survives unchanged: the 7702 Universal Account, the unified balance, the verb layer, back/copy sized as a fraction of the copier's own balance, receipts as the only surface where chain names appear, EVM↔EVM as the spine with Solana as upside. The desk posts through `postConviction` and is backed through `copyConviction` — the same verbs as any human author. This is a supply-side change, not an architecture change.

## What changes

**Supply.** The desk becomes the first author. Human authors arrive in a later phase; creator payments later still.

**Curation.** Convictions are no longer only a feed; the top of the product is a daily deck of ~5 cards per user, selected from a larger candidate pool by the diligence gate and the user's envelope.

**One amendment to CONTEXT.md.** The line "humans and agents are indistinguishable as authors" is retired. Desk cards are visibly desk-authored. Undisclosed house authorship of positions on our own execution rails is a trust problem and a regulatory fact pattern; disclosed, the desk is a brand asset — agents with wallets, faces, and win-loss records.

## Language

**The Desk**: The set of house agents that research, hold, and publish positions with their own capped capital. *Avoid*: AI picks, recommendations, signals.

**Card**: A conviction rendered for the deck — thesis, evidence, risk, and the author's live position receipt. *Avoid*: pick, tip, idea.

**Deck / Drop**: The 5 cards published daily at one fixed global time. One deck, shared by everyone — the drop is the bell; crypto has no market open, so Conviction invents it. *Avoid*: feed (the deck sits above the feed, it does not replace it), picks of the day.

**Diligence gate**: The automated onchain checks a candidate must pass before it can become a card. A listing requirement, not a research feature. *Avoid*: filter, screen.

**Envelope**: A user's learned preference and risk boundary — what they are willing to hold, at what size. Trained by swipes and backs. The envelope selects and bounds; it never originates trades. *Avoid*: preference model (internal term only), taste profile.

**The Wire**: The internal, always-on anomaly scanner feeding the candidates table. Detectors, not opinions; rows, not posts. The wire is commodity infrastructure — the desk's edge is the verification and capital layered on top of it. *Avoid*: signals (implies advice), alpha feed.

**The Brief**: The daily email rendering of the drop — scoreboard, then the deck, identical for all subscribers. *Avoid*: newsletter (externally fine, internally imprecise), digest.

**Skip / Save / Back**: The three swipe verbs. Skip is a soft negative. Save is interest without capital. Back is the only label that moves money and outweighs everything else.

## The Desk

Each desk agent is a persistent identity whose account is **exactly a user's account**: its own EOA, 7702-upgraded into a Universal Account (Path B from CONTEXT.md / ADR 0007 — the agent operates its own UA, never a user's), funded with a hard-capped amount of house capital. The UA is what makes the desk cross-chain without per-chain wallet machinery: the EOA address is identical on every EVM chain, the 7702 authorization is signed per chain (per the build guide's demo pattern), and the agent's capital and positions across chains are one unified balance under one address on every receipt. Optionally, a single ERC-8004 registration on the settlement chain (Arbitrum, per ADR 0005) anchors the agent's handle to that address as verifiable onchain identity — an anchor, not infrastructure, and not load-bearing for Phase 1. The desk dogfoods the same account model it publishes cards into. Keep Margin Call's brands and infra separate — its NFT/token-bound wallet pattern does not transfer here, because a token-bound account cannot be 7702-upgraded and would forfeit chain abstraction. Two structural rules: **separate books, never consensus** — each agent positions its own wallet, and there is no merged house position or signal-averaging layer, because separate books preserve accountability (whose call was it), character (inter-agent disagreement is content), and per-agent ablation. And **identity decoupled from method** — an agent's public layer (wallet, journal, track record, voice) is permanent, while the analysis modules behind it are pluggable and swappable; methods improve, characters persist, and the track record is never reset. Method changes are proposals: the journal and ablation harness produce them, a human approves and versions them, and an agent never ships changes to itself. Personas differentiate on risk appetite, holding period, chain specialty, and voice — dimensions enforceable in their wallet caps — never on cosplayed investor philosophies.

Agent policy caps, enforced in the verb layer: per-trade cap, daily cap, token allowlist, max % of token liquidity, **turnover limits** (churn bleeds fees even when directionally right), and **circuit breakers** (automatic halt on drawdown or anomaly thresholds, human required to resume). Exit machinery is first-class engineering, not an afterthought: the consistent lesson from agents trading real capital at scale is that theses don't kill agent traders — sizing, unfilled orders, and stop management do. Shadow-desk replays should be instrumented to surface exit-path failures specifically.

The desk's public accountability rules are absolute: every position and exit is onchain and public, entry timestamps precede card publication and are printed on the receipt, and the desk cannot add to a position for a fixed window after its card publishes — it never profits from stacking into its own copiers' flow. The desk's track record page is the marketing site.

Each desk agent keeps a **decision journal**: every position and every pass logged with plain-English reasoning *plus a fixed tag schema* (setup type, mistake tag, lifecycle phase: entry / management / exit) so entries are comparable data, not diary prose. Lessons distilled from closed positions are read back at the T-2h review — and enforced, not just recalled: every new position is diffed against the agent's own prior lessons, and contradictions are flagged ("this entry violates your stated lesson from May"). A streak detector runs over the tags — the same mistake tag across three periods is a process defect, not variance — and prioritizes ablation targets. Lessons that keep proving out can **graduate into policy caps** through the same governance as method changes: journal proposes, ablation validates, a human approves, and the lesson becomes a verb-layer constraint. The outcome database tracks tokens; the journal tracks the desk's own judgment — it is what makes agents improve rather than merely persist, and both its lessons and its self-contradictions are brief material ("what the desk learned," "the desk broke its own rule"). Every pipeline layer — verification, priors, journal, editorial — must be **ablatable**: replayable against the baseline without it, so each layer demonstrably earns its complexity.

How candidates become cards is specified in the curation pipeline below. The separation-of-powers pattern is the marketing language — one agent is paid to say no — and the diligence gate genuinely is that agent; internally it is an honest pipeline, not a parliament.

## Diligence gate

No card ships — desk or, later, creator — without passing automated onchain checks: holder concentration, deployer wallet history, liquidity depth and lock status, contract verification, mint/upgrade authority, and (for creator cards) author-to-deployer affiliation. **Routability is a listing requirement**: a candidate is backable only if the UA routing layer (LI.FI) can route into the token — unroutable candidates can appear only as non-backable card types (gate kills, observations), never as positions. Failures are hard failures. The gate's criteria are versioned in the repo and referenced by every card ("passed gate v3").

This is the structural advantage over equity-chatter research products: token diligence has ground truth in chain state. The gate cites facts, not sentiment.

## Curation pipeline (how the drop gets made)

The core constraint that separates this from OpenTrade: their cards are free to mint — ours are positions. A deck that demands 5 new positions daily is a machine that trades on an editorial calendar instead of on edge. So the deck is **5 cards, not 5 new positions**, drawn from four card types:

**New position** — the desk opened something. 1–3 per day, whatever clears the desk's conviction threshold. Some days zero, and the deck says so.

**Position update** — an open desk position whose thesis materially moved: refreshed "why now," still holding, live receipt.

**Exit** — the desk closed a position, with realized PnL and a post-mortem. Published wins and losses alike; these are the trust cards.

**Gate kill** — a token trending across ingestion sources that failed the diligence gate, with the failing facts. The agent paid to say no, made visible. Content on days with nothing to buy, a warning rather than a recommendation (the legally safest card in the deck), and the card type nobody else can produce.

New positions carry the deck when the market gives edge; updates, exits, and kills keep the ritual honest when it doesn't. The desk never trades to feed the deck.

**The daily schedule:**

*Continuous — the wire.* An always-on scanner samples pool-level metrics across supported chains every few minutes (DEX/aggregator APIs; no LLM at this stage). Detectors run as pure functions over the samples and write structured events — token, chain, detector, metrics, score — to a candidates table. Core detector taxonomy: **volume/liquidity divergence** (primary trigger in the micro-cap universe — thin pools absorbing outsized volume), **volume/mcap divergence** (high volume, flat price), **relative strength** (green token on a red tape), **fresh-pool absorption**, **launchpad lifecycle events** (new listings, graduations), **liquidity events** (adds, pulls, lock changes), **holder-concentration deltas**, and **deployer-wallet reputation events**. Curated X/Farcaster lists and price movers feed the same table. Everything accumulates under heuristic scores.

*Verification (top slice, pre-thesis).* The highest-scoring candidates get a wallet-level pass before any LLM sees them, because the strongest-looking anomaly patterns are also the most spoofable — wash trading manufactures both the volume-divergence shape and buy/sell flow imbalance. Discrimination checks: unique active wallets, buyer/seller funding-graph overlap, txn size distribution, net supply absorbed by genuinely new holders. Flow imbalance counts only when it reduces to distinct funded wallets, never raw txn counts. The rule that follows through the whole pipeline: **every narrative claim in a card must reduce to a checkable onchain fact.** "Accumulation" means counted wallets with no common funding ancestor, or it isn't said. Wash-trading detections are prime gate-kill card material.

*Cohort priors.* A standing outcome database tracks every token launch on supported chains — bucketed by mcap, liquidity, age, launchpad — through to outcome (multiple achieved, bled out, rugged, survived 30/90 days). Cards quote computed priors in the gate report ("tokens in this cohort rug within a week 61% of the time"); the same base rates inform gate thresholds over time. Priors are auditable against chain history — quoted only when computed, never as flourish.

*T-6h* — the top ~50 verified candidates go to thesis generation: one LLM pass asking whether an actual "why now" exists. Roughly half die as volume noise. Survivors are scored on two axes: signal strength and **story value** — novelty (pattern or token not covered recently), stakes, surprise, and character continuity (deployers, tokens, or theses the brief has covered before; the cohort database is the continuity index).

*T-4h* — survivors hit the diligence gate. Hard fails on onchain facts. A ~10:1 candidates-to-cards kill ratio is healthy; the kill rate is itself a published metric, and the most instructive kills become gate-kill cards.

*T-2h* — desk agents review gate survivors and position only what they actually believe, sized within their policy caps (per-trade cap, daily cap, token allowlist, max % of token liquidity — enforced in the verb layer, in code). Entry lands onchain now, before any card exists.

*T-0, the drop* — the deck is assembled as an **issue**, not a ranked list: editorial mix rules govern composition (a lead, a follow-up on an open arc, a kill, a wildcard — never five interchangeable momentum cards), and the desk voice is held to a versioned voice guide (controlled diction, banned vocabulary, every narrative claim reducible to a checkable fact). Published at the fixed global time.

Drop timing is one global time for one global deck. A shared deck creates a shared daily object — per-card floor discussion only works when everyone is looking at the same card — and the deck is an editorial voice, which is a brand. Candidate time: 9:30 ET, inheriting the cultural resonance of the open.

## Card anatomy

Fixed template, no freeform cards. Forced structure is what makes swipe labels usable.

1. **The position** — token, direction, size, entry, author, live receipt link.
2. **Thesis** — why, in the author's voice. Short.
3. **Why now** — dated timeline of the 2–3 events that make this current.
4. **What breaks it** — the falsifier, stated by the author. Mandatory.
5. **Gate report** — the diligence facts, rendered plainly.

Every card also carries a structured feature record (chain, token age, market-cap bucket, liquidity bucket, direction, sector tags, author, thesis length, card type) logged at render time so every swipe label attaches to features, not an opaque blob. Only new-position and position-update cards are backable; exits and gate kills take skip/save and floor discussion but never open the sizing sheet.

An **Ask** affordance on each card opens a chat scoped to the position. Deep research is pull-based only — never pre-generated per user — and cached per token per day. Which questions a user asks before backing is itself high-value envelope signal ("what breaks it" before every back = risk-first user).

## Deck and swipe

One global deck at one global time. Phase 1 ships without personalization by design: a shared deck is a shared daily object and an editorial voice. When the envelope arrives (Phase 2), its first job is reordering the global 5 per user — filtering the candidate pool into genuinely different per-user decks is a later decision, and possibly never the right one.

Swipe semantics: left = skip, up = save, right = back (opens the sizing sheet: preset fractions of unified balance, sourced cross-chain, one confirm). A right-swipe that abandons the sizing sheet is logged as strong interest, not as a back. Label weighting for the envelope: back ≫ save > completed-deck skip > skip; dwell time and Ask usage are secondary features.

## Distribution (the brief)

The drop is a publication first and an app surface second. At drop time, the deck ships as a daily email — **the brief** — identical for every subscriber, in a fixed issue structure: **The Tape** (short market orientation computed from the wire's own cross-chain data — indices, volume, where today's cards come from — plus a headline digest; measured claims, never vibes), then **the Scoreboard** (yesterday graded: desk PnL, open positions marked to market, exits with realized numbers, receipts linked), then **the Deck** (today's 5 cards, each deep-linking to its app card). The brief is the deck verbatim, one editorial artifact rendered twice; it is never a separate product with separate content.

The scoreboard leads because it is the section no other daily can write honestly: the brief grades its own previous issue against onchain receipts, losses in the same slot and type size as wins. Email requires no wallet — it is the top of the funnel, and the app is the execution layer.

The brief also carries legal weight: a regular, general-circulation publication sent identically to all subscribers is the bona fide-publisher pattern (the Advisers Act newsletter carve-out, the Lowe line). Personalizing the email would break that posture — one more structural reason the deck stays global. Confirm in the Phase 1 legal read.

Secondary channels (X, Farcaster) repost the drop as threads/casts with the same content and link into the brief and app. One voice, many renderings.

## Envelope and autopilot (later phase)

The envelope learns hold-willingness: chains, market-cap ranges, liquidity floors, sectors, direction/leverage tolerance, sizing habits. It has exactly two jobs — rank the candidate pool into the user's deck, and eventually bound autopilot.

Autopilot, when it ships, is constrained copy only: back convictions from authors above a published performance bar, filtered through the user's envelope, sized by the user's explicit caps (per-trade, daily, allowlist — the same policy primitives as the desk's own wallets). The envelope never originates trades. "The model trades for you" is not a feature of this product in any phase.

## Creator program (deferred)

Paying authors for convictions is right and comes last. Three non-negotiables, all enforced in the verb layer rather than terms of service:

1. **Exit discipline.** A creator cannot exit before their copiers. Position locks or mandatory disclosed-exit windows, enforceable because the creator's position is onchain.
2. **Payout basis.** Creators earn from copiers' realized PnL and/or fees on backed volume, vesting against performance. Never per post, never per engagement, never per back at time of back.
3. **Affiliation checks.** The gate screens creator wallets against token deployer/insider wallets. A creator posting a conviction on a token they're connected to is a hard block, not a disclosure.

Anything weaker is a pump-and-dump machine with a payroll.

## Phases

**Phase 0 — Shadow desk.** Full pipeline live — wire, verification, gate, journal, editorial — with paper positions only. Internal daily briefs generated and graded; voice guide iterated against real chain data. The shadow period is a test, never a track record: the public record begins the day wallets are funded, and shadow-period numbers never appear anywhere user-facing.

**Phase 1 — The Desk.** 2–3 desk agents, funded and capped. One global daily drop of 5 cards mixing the four card types. Skip/save/back on the spine, EVM↔EVM. Gate v1. Feature logging from day one. No envelope; no personalization. Ship when the spine demo works end-to-end: 7702 upgrade → deposit → back a desk card cross-chain → receipt resolves.

**Phase 2 — Human authors.** Twitter-login authors post convictions through the same template and gate. Author track-record pages. Deck becomes mixed-author; desk cards visibly badged. Envelope v1 begins ranking.

**Phase 3 — Creator payments.** The three non-negotiables above, live. Payouts from backed-volume fees.

**Phase 4 — Autopilot.** Constrained copy within the envelope and explicit user caps. Opt-in, dry-run mode first.

## Non-goals

No AI price targets, target multiples, or projection sliders. No backtested or simulated returns anywhere in the UI — only live, onchain, out-of-sample records. No selective disclosure: every desk position, exit, and gate outcome is public; the track record is never a curated subset. No token-gated access — no Conviction token whose holding unlocks cards, the brief, or delivery speed; the product is never a demand sink for a house asset. No engagement-gated information (no "like to unlock the CA"). No signal-to-execution piping without a human back or an explicit envelope-bounded autopilot policy. No anonymous authorship. No persona-branded strategies named after real people. No infinite feed as the primary surface. No custody of user keys.

## Metrics

Drop ritual: DAU at drop time, deck completion rate. Brief funnel: subscribers, open rate at drop time, email-to-app click-through, subscriber-to-wallet conversion. Conversion: back rate per card, backed volume, save-to-back conversion. Desk quality: desk PnL (public), gate kill rate, card-level back rate by desk agent. Data: labels per user per week, envelope ranking lift vs. desk-confidence baseline (measured by back rate). Trust: receipt open rate, Ask usage before backs, scoreboard section engagement.

## Risks and open questions

**Adviser drift.** The desk-as-author framing is the mitigation, not an immunity. Wants a real legal read before Phase 1 ships publicly, specifically on house authorship + house execution rails in relevant jurisdictions.

**Card supply quality.** Five cards a day is an editorial promise. If the pipeline can't produce five gate-passing, genuinely differentiated theses daily across supported chains, ship fewer cards rather than lower the gate.

**Desk capital at risk.** House capital in volatile tokens is a real cost center and a public one. Caps are small; the desk's job is credible content and track record, not treasury returns.

**Copy execution in thin liquidity.** Backs into illiquid tokens can move price against later copiers and reward earlier ones. Gate liquidity floors mitigate; may need per-card aggregate back caps.

**Inference cost.** Bounded by the deck size, pull-based deep research, and per-token-per-day caching. Watch Ask usage economics in Phase 1.

**Open:** the exact global drop time (9:30 ET is the leading candidate), the no-add window length after card publication, whether saves expire, desk agent count and persona design (Margin Call-adjacent characters, separate brand), whether Phase 2 authors need a minimum onchain history to post, and whether to open-source the wire (detectors, candidates schema, cohort methodology) as a credibility/distribution play — the commodity layer is not the moat, and the verification + capital + editorial layers stay closed either way.
