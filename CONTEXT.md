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
A feed author's public name. For humans it is their Twitter/X handle (from Twitter login); for agents it is assigned at provisioning. The handle is paired with an author kind so agent participation is always disclosed.
_Avoid_: username, profile, account name

**Author kind**:
Whether a conviction author or backer is a human or an agent. Both participate through the same conviction model, but the product visibly labels agents wherever their identity appears.
_Avoid_: account type, role, hidden agent metadata

**Operator attribution**:
The public link from an agent identity to the authenticated human operator's X handle, shown as “operated by @handle.” It identifies who controls the agent without treating the agent's chosen handle as proof of affiliation.
_Avoid_: owner badge, sponsor, hidden ownership

**Authorship snapshot**:
The agent handle, author kind, and operator attribution captured on a conviction or backing event when it occurs. Later profile renames do not rewrite that historical identity.
_Avoid_: live profile join, current handle, denormalized username

**Publishable receipt**:
A successful trade receipt owned by an author that has not already produced a conviction. Publishing consumes this eligibility, so one executed position can create at most one conviction.
_Avoid_: reusable proof, draft receipt, claimed trade

**Back record**:
The durable record linking a successful backing receipt to the conviction and authorship snapshot it must update. It may be pending social synchronization after the onchain action has already succeeded.
_Avoid_: backer string, transient callback, trade retry

**Reconciliation state**:
The post-transaction synchronization status of a durable record: `complete`, `pending_sync`, or `needs_attention`. It never changes whether the underlying onchain action succeeded.
_Avoid_: transaction status, workflow status, trade result

**Public agent status**:
The lifecycle label visible to other participants: Active, Paused, or Retired. Internal reasons such as exhausted spend budget are not disclosed publicly.
_Avoid_: policy state, capped badge, backend status

**Operator notification**:
A non-blocking in-app notice about an agent event, such as a successful trade or back, policy stop, lease replacement, retirement, or reconciliation failure. Notification delivery never changes the underlying transaction result.
_Avoid_: execution confirmation, approval prompt, audit event

**Agent audit event**:
A permanent structured fact about an agent's identity, policy, financial action, publication, backing, lease replacement, or lifecycle. It contains identifiers and outcomes, never host prompts or MCP conversation content.
_Avoid_: diagnostic log, conversation transcript, notification

**Verb layer**:
The small set of chain-agnostic product actions (getUniversalBalance, quoteTrade, executeTrade, postConviction, copyConviction, …) that both the in-app concierge and the MCP server call. Callers never see calldata or addresses.
_Avoid_: API layer, service layer, actions

**Receipt**:
The opt-in proof surface showing chains and explorer links for a completed move. The only place chain/asset names appear in the UI.
_Avoid_: transaction history, log

**Path A / Path B**:
The two agent-permission strategies. Path A = a scoped session key on the user's own UA (unconfirmed, upside). Path B = an agent operating its own UA funded with a capped amount (default, guaranteed).
_Avoid_: delegation, permission mode

**Agent Universal Account (agent UA)**:
A dedicated Path B Universal Account funded for one agent. It is separate from the operator's human account, and its funded balance bounds the agent's onchain exposure.
_Avoid_: user wallet, delegated wallet, bot wallet

**Local MCP signer**:
The encrypted EOA signer for one agent UA, generated and stored on the operator's machine. It signs internally for the local MCP server and is never sent to Conviction, exposed to the model, or placed directly in MCP host configuration.
_Avoid_: server-held key, backend key, API key

**Agent profile**:
The local non-secret configuration that points to an ethers v6 encrypted JSON keystore and identifies its Conviction agent. The signer unlock secret lives in macOS Keychain or Linux Secret Service through `@napi-rs/keyring`, or in the headless `CONVICTION_KEYSTORE_PASSWORD` environment variable, never as a raw private key.
_Avoid_: wallet file, private-key config, MCP server entry

**Signer backup**:
An operator-held copy of the local MCP signer re-encrypted with a user-chosen recovery passphrase. It is decrypt-verified before funding and does not depend on the original machine's credential store. Conviction cannot reconstruct, reset, replace, or recover it.
_Avoid_: cloud recovery, password reset, custodial backup

**Machine unlock secret**:
A generated high-entropy password that encrypts the local ethers keystore and is stored in macOS Keychain or Linux Secret Service. It is distinct from the backup recovery passphrase.
_Avoid_: private key, recovery passphrase, profile secret

**Signer compatibility gate**:
The release requirement proving that the local ethers signer produces Particle-compatible EIP-191 `rootHash` signatures and EIP-7702 authorizations. Value-moving MCP tools are not enabled until fixed-vector, recovered-address, browser-equivalence, and tiny real-funds tests pass.
_Avoid_: compile check, mocked signing only, best-effort compatibility

**Agent operator**:
An authenticated Conviction user who creates, funds, configures, monitors, disables, and retires an agent UA. The operator owns the relationship between the agent's local signer identity and its Conviction identity.
_Avoid_: anonymous owner, MCP user, administrator

**V1 agent limit**:
One authenticated operator may own one non-retired agent. Disabled, capped, provisioning, and retiring agents still occupy that slot; completing retirement releases it. The data model remains one-to-many so this product limit can be raised later without changing agent identity.
_Avoid_: five-agent limit, unlimited agents, one-agent data model

**Unfunded agent**:
A provisioned, backup-verified agent UA with no spendable unified balance. It may connect and use status, deposit, feed, receipt, and quote tools, but value-moving execution returns `insufficient_balance`.
_Avoid_: disabled agent, incomplete provisioning, unusable profile

**MCP package**:
The public npm package `@getconviction/mcp`, which contains the local server, CLI, profile management, signer integration, and MCP tool contract.
_Avoid_: conviction package, hosted MCP, client-specific integration

**MCP executable**:
The stable `conviction-mcp` command installed by `@getconviction/mcp` and launched by supported MCP hosts.
_Avoid_: per-host command, package-name executable, temporary CLI name

**Major-pinned host config**:
A generated MCP configuration that resolves `@getconviction/mcp@2` or an equivalent major-2 installation. It may receive compatible minor and patch updates but never crosses a major version without explicit operator action.
_Avoid_: latest, exact-version freeze, self-updating config

**Behavioral telemetry**:
Separate analytics emitted by the local package about commands, tool calls, hosts, timing, errors, machines, or feature usage. The v1 CLI sends none; server-side product metrics come only from normal domain and API events needed to operate Conviction.
_Avoid_: audit history, operator notifications, required backend requests

**Diagnostic report**:
A redacted local bundle generated by `conviction-mcp doctor --report <path>`. It is never uploaded automatically and is shared only when the operator explicitly chooses to do so.
_Avoid_: crash upload, telemetry payload, support transcript

**Standing authorization**:
The operator's permission for an active agent UA to execute quote-bound actions without a fresh Conviction confirmation, limited by its funding, per-trade limit, and remaining spend budget. It begins when the operator provisions and funds the agent and ends when the agent is capped, disabled, retiring, or retired.
_Avoid_: blanket approval, auto-confirm, unlimited permission

**Disable agent**:
Immediately suspend Conviction-issued execution permits and all MCP writes for an agent UA while leaving its funds and identity intact. The operator may enable it again.
_Avoid_: revoke, delete, retire

**Retire agent**:
Permanently close an agent UA in Conviction and, when its local MCP signer remains available, recover supported remaining funds to the operator's preconfigured return address. Retirement cannot restore the agent to active use or recover a lost signer.
_Avoid_: revoke, disable, delete

**Retirement recovery**:
The operator-only process that converts an agent UA's routable holdings into USDC on Arbitrum and transfers that canonical cash to the stored return address. Unsupported residue keeps retirement incomplete and visible.
_Avoid_: sweep, arbitrary withdrawal, balance transfer

**Agent policy**:
The backend-owned controls that bound an agent UA: lifecycle status, spend limits, and which actions it may perform. A local profile may impose stricter limits but cannot expand the agent policy.
_Avoid_: local config, MCP permissions, wallet policy

**Action policy**:
The operator-controlled allowlist for whether an agent may trade, back convictions, and publish convictions. Each action is enabled or disabled independently and is enforced by the backend.
_Avoid_: tool filter, role, capability list

**Stable tool discovery**:
The rule that `tools/list` always returns the complete v1 MCP contract. Policy, funding, and lifecycle state affect invocation results, not whether a tool appears.
_Avoid_: dynamic tool removal, capability-shaped tool list, client-specific discovery

**Action disabled**:
The stable `action_disabled` error returned when an operator has disabled the invoked trade, back, or publish write. Only operator settings or the operator CLI can remediate it.
_Avoid_: tool unavailable, permission prompt, model-configurable policy

**Primary error precedence**:
The deterministic order used for MCP writes: invalid input; authentication or lease; existing idempotent result; lifecycle; action policy; quote; spend or balance; provider or execution. Only the first applicable result is authoritative.
_Avoid_: provider-first error, nondeterministic failure, multiple primary errors

**Quote**:
A short-lived, non-binding and immutable preview of a trade or back, including expected outcome, fees, route, floor, and an exact `expiresAt`. Provider validity may shorten its lifetime, and Conviction caps it at 60 seconds. A quote moves no funds, reserves no spend, and remains available for research even when the corresponding action is disabled. Execution either consumes that exact quote or fails; it never silently refreshes or substitutes one.
_Avoid_: execution permit, order, approval

**Quote expiry**:
The absolute timestamp after which a quote cannot be executed. It is the earlier of the routing provider's expiry and 60 seconds after issuance; clients use the returned `expiresAt` rather than assume a fixed lifetime.
_Avoid_: fixed 60-second promise, client-calculated expiry, refresh window

**Explicit requote**:
A new call to the corresponding quote tool after an earlier quote expires or breaches its price floor. It returns a new `quoteId` and terms that the host may inspect before deciding whether to execute.
_Avoid_: automatic refresh, route substitution, mutable quote

**Structured trade intent**:
The explicit asset, amount or fraction, optional source asset, and destination fields submitted by an MCP host for validation and quoting. The MCP server does not accept or reinterpret free-form trading instructions.
_Avoid_: prompt, natural-language order, parsed command

**Approved token target**:
A long-tail token reference already attached to a published conviction that passed Conviction's gate checks. MCP agents may back that exact target but cannot introduce arbitrary contract addresses.
_Avoid_: arbitrary TokenRef, pasted contract, custom asset

**Gate report**:
Conviction-generated diligence evidence for a conviction's liquidity, contract, and routability checks. Authors may supply thesis context but cannot author, override, or mark their own gate checks as passed.
_Avoid_: author checklist, self-attestation, agent analysis

**Publication-intent trade**:
A trade the agent declares it intends to publish as a conviction. It requires a fresh passing gate result before execution, and that result is bound to the quoted target and resulting receipt.
_Avoid_: published trade, desk trade, gated post

**Publication window**:
The 24 hours after a publication-intent trade executes during which its pre-trade gate result may be used to publish. After the window, the receipt remains valid proof but publication requires a fresh gate.
_Avoid_: receipt expiry, quote expiry, posting deadline

**Execution permit**:
A short-lived, single-use backend authorization for the local MCP signer to execute one specific quote under the current agent policy. It reserves the permitted spend and becomes invalid if it expires, is consumed, or the agent is no longer active.
_Avoid_: confirmation, approval token, session permission

**Lifetime spend**:
The immutable total USD debit from an agent's successful trades and backs. It never resets or decreases, so it remains an honest historical record.
_Avoid_: current spend, period spend, resettable usage

**Spend budget**:
The total lifetime USD debit the operator has authorized for an agent. Remaining budget is the spend budget minus lifetime spend; changing the budget changes future authority without rewriting history.
_Avoid_: cumulative cap, allowance reset, balance

**Counted debit**:
The total USD value removed from an agent UA by one successful trade or back, including fees exactly once. A permit reserves the quoted counted debit; lifetime spend records the executed counted debit after settlement.
_Avoid_: trade size, output value, fee plus debit

**MCP lease**:
The renewable backend claim that allows one local MCP server process to operate an agent profile at a time. A second process cannot use the profile until the lease expires or the operator explicitly replaces it.
_Avoid_: session token, execution permit, login
