# Conviction

Chain-abstracted social trading. Users hold a single chain-abstracted account, trade from one unified balance, and publish trades with reasoning that others can copy regardless of which chain their own funds sit on.

## Language

**Universal Account (UA)**:
The chain-abstracted account. In EIP-7702 mode it is the user's own EVM EOA, upgraded in place — same address, no migration.
_Avoid_: smart wallet, smart account, new account

**Unified balance**:
The user's assets across all chains, shown and spendable as a single USD number. The Home dashboard also surfaces per-asset breakdown (symbol, balance, price, portfolio %) in a wallet-style view.
_Avoid_: total, portfolio, aggregate balance

**Spine**:
The guaranteed end-to-end protected path: 7702 upgrade → unified balance reflects deposits → one cross-chain trade via UA → receipts resolve. EVM↔EVM is the spine; Solana is upside.
_Avoid_: core flow, happy path

**Conviction**:
A posted trade plus a short thesis on the public feed — the decision-carrying record others read and copy.
_Avoid_: post, call, signal, tip

**Card**:
A conviction rendered with its full anatomy: position / thesis / why-now timeline / what-breaks-it / gate report. Not a separate entity — the conviction schema carries the extra fields (optional), and `postConviction` accepts them.
_Avoid_: desk card (as a distinct entity), post

**Back / copy**:
Mirroring a conviction's direction, sized as a fraction of the copier's own unified balance and sourced cross-chain from wherever their funds sit. Not the original's dollar size.
_Avoid_: follow, mirror trade, copy-trade

**Desk**:
The house trading identity: a dedicated X handle (normal Twitter login per ADR 0009) with its own funded UA. Every desk card is a revealed position opened before publication. During Build 1 the desk is a human plus `gate-check.ts`; in Build 2, desk agents post through the same identity model.
_Avoid_: admin, house account, official account

**Deck**:
The primary surface: the swipeable stack of cards a user lands on after login. Swipe verbs are skip / save / back. Swiped cards land in the feed (the archive, newest drop first); an exhausted deck shows a considered end state pointing to the feed and saved cards.
_Avoid_: feed (for the card stack), timeline, stack

**Handle**:
A feed author's identity. For humans it is their Twitter/X handle (from Twitter login); for agents it is assigned at provisioning. Humans and agents are indistinguishable as authors.
_Avoid_: username, profile, account name

**Verb layer**:
The small set of chain-agnostic product actions (getUniversalBalance, quoteTrade, executeTrade, postConviction, copyConviction, …) that both the in-app concierge and the MCP server call. Callers never see calldata or addresses.
_Avoid_: API layer, service layer, actions

**Receipt**:
The opt-in proof surface showing chains and explorer links for a completed move. The only place chain/asset names appear in the UI.
_Avoid_: transaction history, log

**Path A / Path B**:
The two agent-permission strategies. Path A = a scoped session key on the user's own UA (unconfirmed, upside). Path B = an agent operating its own UA funded with a capped amount (default, guaranteed).
_Avoid_: delegation, permission mode
