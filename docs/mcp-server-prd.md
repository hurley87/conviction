# PRD: Conviction MCP Server

> Status: proposed
> Date: 2026-07-16
> Owner: Conviction
> Related decisions: ADR 0007, ADR 0010, ADR 0014, ADR 0017, ADR 0018, ADR 0019, ADR 0020, ADR 0021, ADR 0022, ADR 0023, ADR 0024, ADR 0025, ADR 0026, ADR 0027, ADR 0028, ADR 0029, ADR 0030, ADR 0031, ADR 0032, ADR 0033, ADR 0034, ADR 0035, ADR 0036, ADR 0038, ADR 0039, ADR 0040, ADR 0041, ADR 0042, ADR 0043, ADR 0044, ADR 0045, ADR 0046, ADR 0047, ADR 0048
> Related issue: GitHub #7

## 1. Product summary

Conviction will ship a local Model Context Protocol (MCP) server that lets people use Conviction from Claude Code, Codex, Hermes, OpenClaw, and other MCP-compatible hosts.

The MCP server is a second product surface over Conviction's existing verb layer. It does not create a separate trading implementation. Each running server instance controls exactly one agent Universal Account (agent UA), funded with an intentionally limited amount. The agent can inspect its account, read the conviction network, quote and execute trades, publish convictions, and back existing convictions.

The MCP tool surface will never expose arbitrary external transfers, private-key access, policy changes, provisioning, disablement, or retirement. Those capabilities remain in operator-only settings and lifecycle controls.

## 2. Why this should exist

Conviction currently serves humans through a browser experience, but its core differentiator is equally valuable to agents: one unified balance can fund a position across supported chains, and the resulting trade can be shared and backed through the same conviction network.

Without an MCP surface, every agent framework would need a custom integration. An MCP server creates one portable interface that can be discovered and used by multiple hosts without teaching each host Particle, EIP-7702, LI.FI routing, Conviction storage, or receipt semantics.

The product promise is:

> Give an agent a small funded Conviction account, connect one MCP server, and let it research, trade, publish, and back convictions without exposing a withdrawal tool or raw signing key.

## 3. Existing product and architecture baseline

The implementation must build on the current repo rather than replace it:

- `src/lib/ua/*` already isolates the Particle Universal Account SDK behind `UAClient`.
- `src/lib/verbs/*` already owns intent validation, quoting, execution, copy sizing, receipts, and conviction construction.
- The app already supports a unified balance, deposits, quotes, cross-chain execution, receipts, convictions, backing, activity, and feed summaries.
- ADR 0007 defines Path B security as fund isolation plus capability scoping, not cryptographic delegation.
- ADR 0010 selects a local stdio MCP server with one process per agent UA.
- ADR 0014 requires mocked deterministic CI and manually gated real-funds tests.

Two gaps must be addressed before the MCP is production-ready:

1. The live UA adapter currently receives browser/Privy signing callbacks. The MCP process needs a local MCP signer implementation.
2. Conviction feed writes currently trust caller-supplied handles. Agent writes need authenticated identity, replay protection, and server-assigned authorship.

## 4. Goals

### Product goals

- Let a user connect Conviction to Claude Code, Codex, Hermes, or OpenClaw in less than ten minutes after provisioning an agent.
- Give all supported hosts the same tool names, schemas, behavior, and safety boundaries.
- Let an agent use the same Conviction network as humans: shared convictions, receipts, and backer attribution.
- Preserve the existing verb layer as the source of truth for trading behavior.
- Make every value-moving action bounded, attributable, auditable, and recoverable.
- Keep the agent's private key local to the operator's machine.

### Success criteria

- A fresh agent can be provisioned, funded, connected, and queried from each target host.
- The same package and stdio command work across all four hosts.
- An agent can complete the sequence: inspect balance → read convictions → quote → execute → publish or back → retrieve receipt.
- Agent-authored convictions appear in the same app surfaces as human-authored convictions.
- No MCP tool accepts an arbitrary destination address or returns secret key material.
- Per-trade limits, lifetime spend, and spend budgets survive process restarts.
- Disablement immediately stops future MCP writes.
- Retirement permanently closes the agent and recovers supported remaining assets through an operator-only flow.

## 5. Non-goals

- A hosted, multi-tenant MCP endpoint in v1.
- OAuth for the MCP transport in v1.
- Operating a human user's existing Privy wallet from a local agent.
- Cryptographic session keys on a human's UA (Path A).
- Autonomous scheduling, recurring trading, stop-losses, or portfolio rebalancing.
- Arbitrary token transfers or withdrawals through MCP tools.
- Mainnet real-funds execution in CI.
- Supporting client-specific tool contracts or separate integrations per agent framework.
- Hiding chain and asset details from agent tool results. Agents need structured execution context even though the consumer UI remains dollars-first.

## 6. Users

### Agent operator

A person who creates and funds a dedicated agent account, connects it to an MCP host, controls its policy, monitors activity, and can disable or retire it.

### Trading agent

An LLM-driven process that uses MCP tools to inspect the network, form a view, quote a bounded action, execute it, and optionally publish or back a conviction.

### Conviction participant

A human app user who can see and back agent-authored convictions. The product identifies the author as an agent without exposing which MCP host or model created it.

### Conviction operator

The person responsible for monitoring abuse, disabling compromised agent identities, reviewing audit logs, and maintaining package/client compatibility.

## 7. Product principles

1. **One server, one account.** A running server instance is permanently bound to one agent identity, one agent UA, and one local MCP signer.
2. **Quote before execute.** No value-moving tool accepts a fresh free-form trade. Execution consumes a recent server-issued quote.
3. **The model never chooses identity.** The backend derives the handle, agent author kind, and operator attribution from the authenticated agent address; tool inputs never accept or suppress these fields.
4. **No withdrawal-shaped tool.** There is no MCP input that accepts an arbitrary destination address.
5. **Hard controls beat instructions.** Tool descriptions and MCP annotations improve UX, but caps, identity, quote binding, and disabled status are enforced in code.
6. **Onchain success is never hidden by an app-sync failure.** Tool results distinguish execution state from feed/activity synchronization state.
7. **One contract across clients.** Claude Code, Codex, Hermes, and OpenClaw receive identical MCP capabilities.
8. **Provisioning establishes standing authorization.** An active, funded, within-cap agent may execute a valid quote without a fresh Conviction confirmation; MCP hosts may add their own approvals.
9. **The backend is authoritative for agent policy.** Every value-moving action requires a live, one-use execution permit; loss of backend connectivity fails closed for writes.
10. **Write actions are independently permissioned.** The operator may separately enable trade, back, and publish; no MCP tool can change these permissions.
11. **One active MCP session per agent.** Each profile holds one renewable MCP lease; concurrent processes or machines are rejected.
12. **Discovery is stable; authorization is dynamic.** `tools/list` always exposes the complete v1 contract, while current policy and lifecycle state are enforced when a tool is invoked.

## 8. V1 experience

### 8.1 Provision an agent

Any authenticated Conviction user may act as an agent operator and open the Agent Access page. Real agent provisioning is open at launch and requires no invitation or manual approval. V1 does not support anonymous provisioning, imported private keys, or creating an unowned agent directly from the CLI.

An operator may have one non-retired agent in v1. Disabled, capped, provisioning, and retiring agents continue to occupy the slot; completed retirement releases it. The backend ownership model remains one-to-many so a future release can raise the limit without redesigning agent identity or policy.

They provide:

- Agent handle.
- Return address used only by the operator-only retirement flow.
- Maximum USD value per executed trade.
- Initial lifetime spend budget in USD.
- Initial action policy for trade, back, and publish.

Conviction creates a single-use provisioning code that expires after ten minutes. The code carries no trading authority; it only authorizes binding a newly generated public signer address to the pending agent record.

The operator runs:

```text
conviction-mcp init --code <one-time-code>
```

The CLI:

1. Generates an EOA locally.
2. Stores it in an ethers v6 encrypted JSON keystore using scrypt and owner-only `0600` permissions.
3. Sends only the public address and a proof-of-possession signature to Conviction.
4. Exchanges the one-time code for an agent profile owned by the authenticated user who created it.
5. Re-encrypts a signer backup with an operator-chosen recovery passphrase and exports it to an operator-chosen location.
6. Verifies that the backup can be decrypted without exposing the private key.
7. Marks the agent ready for funding and shows the UA deposit address, configured policy, profile name, and client setup snippets.

The private key is never sent to Conviction.

Conviction cannot reconstruct, reset, replace, or recover the local MCP signer or its unlock secret. Losing all encrypted keystore copies or the unlock secret can permanently strand funds in the agent UA.

The web app and CLI do not display the funding address until encrypted backup creation and decrypt-verification complete.

### 8.2 Fund the account

The operator sends a small amount to the displayed UA deposit address. The Agent Access page and CLI status command show when the unified balance is available.

Funding is not required to connect the MCP server. A provisioned, backup-verified but unfunded agent may use account status, deposit-address, feed, receipt, and quote tools. Execution tools fail before signing with the stable error code `insufficient_balance`. Funding the account makes execution eligible without reprovisioning or reconnecting.

### 8.3 Connect an MCP host

The distributed package exposes:

```text
conviction-mcp serve --profile <name>
```

The host launches that command over stdio. The profile points to the encrypted keystore and non-secret agent configuration; raw private-key values should not be embedded in host config.

On macOS and desktop Linux, `init` generates a high-entropy machine unlock secret and stores it through `@napi-rs/keyring` in macOS Keychain or Linux Secret Service. Headless Linux and WSL may instead provide `CONVICTION_KEYSTORE_PASSWORD`. Raw private keys are never accepted through environment variables, CLI arguments, project files, or MCP host configuration.

At startup, the process acquires an MCP lease for the profile and renews it while connected. If another process already holds the lease, startup fails with the current lease age and instructions to wait or explicitly replace it from Agent Settings or the CLI.

Representative setup:

| Host | V1 connection |
|---|---|
| Claude Code | Local stdio server added with `claude mcp add` |
| Codex | Local stdio server added with `codex mcp add` or `config.toml` |
| Hermes | Local stdio entry under `mcp_servers` in `~/.hermes/config.yaml` |
| OpenClaw | Local stdio entry added with `openclaw mcp add` |

The exact snippets are generated by `conviction-mcp init` and included in installation docs.

### 8.4 Use Conviction

A typical agent flow:

1. Read account status and available spend.
2. List or summarize current convictions.
3. Request a trade or back quote.
4. Present or reason over the quote.
5. Execute using the returned `quoteId`; the MCP process obtains a live execution permit before signing.
6. Retrieve the receipt.
7. Publish a conviction from the completed receipt, or complete backer attribution.

The execute step does not trigger a separate Conviction confirmation. The operator already granted standing authorization through provisioning, funding, the per-trade limit, and remaining spend budget. Hosts may still require their own approval before calling a write tool.

### 8.5 Disable or retire

Lifecycle controls are intentionally unavailable to the model.

To pause the agent, the operator disables it in Agent Settings or runs:

```text
conviction-mcp disable --profile <name>
```

Disablement immediately blocks new execution permits and MCP writes while leaving the agent's identity and funds intact. The operator may enable it again. The public profile and history remain visible with a Paused marker.

Budget exhaustion also blocks execution, but `capped` is private policy state. Publicly the profile shows Paused; privately Agent Settings and `conviction_account_status` explain that remaining budget is zero. Increasing the budget returns the agent to Active automatically unless it is independently disabled.

To permanently close the agent, the operator starts retirement in Agent Settings or runs:

```text
conviction-mcp retire --profile <name>
```

Retirement:

1. Moves the backend identity to `retiring`, which blocks all normal MCP writes.
2. Locks the local profile against normal server use.
3. Uses the original local MCP signer through an operator-authenticated recovery flow.
4. Converts all routable holdings into USDC on Arbitrum.
5. Transfers the recovered USDC to the preconfigured EVM return address.
6. Produces separate conversion and transfer receipts plus a residual-holdings report.
7. Moves the identity to `retired` when no recoverable value of $1 or more remains.

If conversion or transfer fails, or residual holdings are worth $1 or more, the identity stays `retiring` with reconciliation state `needs_attention`; normal agent activity remains blocked and only the operator may retry. Residual holdings worth less than $1 total are recorded permanently as unrecoverable dust but do not block completion. A retired identity cannot be re-enabled.

If the local signer is unavailable, the operator can still disable or permanently close the Conviction identity, but Conviction cannot recover or move the remaining funds.

Retirement does not delete or hide historical activity. The public profile, convictions, backs, receipts, authorship snapshots, and “operated by” attribution remain visible with a Retired marker.

## 9. MCP tool contract

Names are prefixed to remain clear when a host connects many servers.

| Tool | Type | Purpose | Important constraints |
|---|---|---|---|
| `conviction_account_status` | Read | Return handle, address, unified balance, deposit addresses, per-trade limit, lifetime spend, spend budget, remaining budget, action policy, and status | Never returns key material |
| `conviction_list_convictions` | Read | List current deck or feed convictions with trade thesis, anatomy, and backer count | Bounded pagination and output size |
| `conviction_get_conviction` | Read | Fetch one conviction by `entryId` | Returns canonical backend record |
| `conviction_summarize_feed` | Read | Return deterministic flags plus a concise digest | Model-generated prose remains optional/fallback-safe |
| `conviction_get_receipt` | Read | Retrieve one receipt and explorer links | Receipt access is read-only |
| `conviction_quote_trade` | Read | Validate structured trade fields and return costs, floor, exact `expiresAt`, optional publication gate result, and `quoteId` | Does not accept free-form instructions; available even when execution is disabled |
| `conviction_execute_trade` | Write | Execute a recent trade quote | Consumes only the supplied unexpired `quoteId`; never silently requotes or changes terms |
| `conviction_publish_conviction` | Write | Publish a completed trade plus thesis, why-now, and what-breaks-it | Requires a successful unique owned receipt; author/trade are server-derived and gate report is system-generated |
| `conviction_quote_back` | Read | Size and quote backing an existing conviction | Available even when backing is disabled; moves no funds and reserves no spend |
| `conviction_back_conviction` | Write | Execute a recent back quote and create durable attribution | Consumes only the supplied quote; never requotes, and never re-executes a successful back |

### Tool behavior requirements

- `tools/list` returns the complete v1 tool set for every provisioned profile, independent of balance, spend budget, action policy, or lifecycle state.
- Tool discovery indicates protocol support, not current authorization.
- All inputs and outputs use explicit JSON Schemas and structured content.
- Trade inputs use the existing constrained `TradeIntent` vocabulary as explicit structured fields. MCP tools do not accept free-form trading text or invoke the LLM intent parser.
- Invalid or incomplete trade fields return stable field-level validation codes and correction guidance rather than a guessed intent.
- Trade inputs may set `publicationIntent: true`. Conviction then requires a fresh passing system gate before the quote is eligible for an execution permit.
- A failed publication-intent gate returns check results and evidence, moves no funds, and reserves no spend budget.
- Direct MCP trade inputs expose named product assets only and reject contract-address or caller-constructed `TokenRef` fields.
- Back tools derive an approved token target, when present, from the canonical published conviction and revalidate support/routability before quoting.
- Quote records include agent ID, action type, intent fingerprint, amount, floor, provider expiry, effective `expiresAt`, and one-time-use status.
- Quote records are immutable. Execution cannot extend their expiry, change their route or floor, or replace them with newly calculated terms.
- Publication-intent quote records also bind the passing gate result, gate version, target fingerprint, and gate expiry.
- Quote tools are research operations: they remain available when the corresponding action is disabled and do not reserve spend budget.
- Quote tools and eligible read tools remain available to an unfunded agent; a quote is an estimate and does not guarantee that execution preconditions are satisfied.
- Quote responses include `issuedAt`, `serverTime`, and an exact `expiresAt`.
- Effective expiry is the earlier of the routing provider's expiry and 60 seconds after issuance. If the provider omits expiry, Conviction applies a conservative configured lifetime no greater than 60 seconds.
- Clients must use `expiresAt`; a quote is not guaranteed to remain valid for a full 60 seconds.
- An expired quote returns `quote_expired`. A quote whose minimum-received floor cannot be satisfied returns `price_floor_breached`.
- Neither failure automatically requests or executes a replacement quote. The host must explicitly call the corresponding quote tool and use the new `quoteId`.
- Immediately before signing, `execute` tools exchange the quote ID and fingerprint for a short-lived, single-use execution permit from Conviction.
- The backend rejects permits for expired, already-used, mismatched, disabled, retiring, retired, capped, or over-limit actions.
- A write disabled by the operator's action policy returns `action_disabled`, identifies the action, and states that only the operator can enable it through Agent Settings or the operator CLI.
- Policy changes take effect immediately without MCP reconnection or a refreshed tool list.
- Value-moving tools reject an unfunded or underfunded account with `insufficient_balance` before signing; this does not change the agent's lifecycle status.
- If the backend cannot be reached, value-moving tools fail closed; read-only tools may continue where their dependencies are available.
- `execute` tools do not request a fresh Conviction confirmation; successful invocation within standing authorization moves funds.
- Successful execute calls persist the receipt and activity record using idempotency keys.
- Publication atomically consumes a successful agent-owned receipt's one-time publishable status.
- The publish tool derives trade metadata from the receipt and cannot publish thesis-only, foreign, failed, pending, backing-only, or already-consumed receipts.
- Publish inputs may include thesis, why-now events, and what-breaks-it, but never `gateReport`.
- Publication of a publication-intent trade consumes the passing gate result bound before execution.
- The pre-trade gate binding remains publishable for 24 hours after execution. After that, publication runs a fresh gate while retaining the same receipt.
- Publication of an ordinary trade runs a fresh deterministic gate; required gate failure rejects publication but never automatically reverses the existing position.
- Execution never auto-publishes. A successful publication-intent trade produces a gate-bound publishable receipt, and the agent must later call `conviction_publish_conviction` with its thesis context.
- Idempotent retries return the conviction already created from that receipt.
- A successful back atomically stores its receipt and one back record before social attribution is attempted.
- If attribution is unavailable after execution, the tool returns `executed_pending_sync` with the successful receipt and durable back-record ID.
- Back reconciliation is idempotent and never retries the onchain trade.
- Reconciliation records expose `complete`, `pending_sync`, or `needs_attention`; this state is separate from the successful onchain result.
- Tool failures use stable machine-readable error codes plus a concise human-readable explanation.
- Writes select one primary result in this order: invalid input; authentication or MCP lease; existing idempotent result; lifecycle; action policy; quote; spend or balance; provider or execution.
- An authenticated retry returns its durable idempotent result before current policy, quote, spend, or balance checks and never submits another transaction.
- Secondary applicable conditions may be included as diagnostic metadata but never replace or obscure the primary code.
- Tools declare MCP annotations such as read-only, destructive, idempotent, and open-world hints where accurate, but annotations are not used as security controls.
- The server initialization `instructions` field explains the quote-before-execute workflow, caps, absence of withdrawals, and the meaning of receipts.

## 10. Identity, authentication, and signing

### Agent identity

Add an `agents` record containing:

- `agentId`
- `ownerUserId`
- `handle`
- `authorKind`: `agent`
- `operatorHandle`
- `address`
- `returnAddress`
- `status`: `provisioning | active | disabled | capped | retiring | retired`
- `publicStatus`: `active | paused | retired`
- `actionPolicy`: `{ trade: boolean, back: boolean, publish: boolean }`
- `maxTradeUsd`
- `spendBudgetUsd`
- `lifetimeSpendUsd`
- `createdAt`
- `disabledAt`
- `retirementStartedAt`
- `retiredAt`
- `activeLeaseId`
- `activeLeaseExpiresAt`

Handles are assigned during provisioning and cannot be supplied or overridden by MCP tool calls. Agent records always carry `authorKind: agent` and public operator attribution derived from the authenticated owner's X identity; clients must not infer ownership or author kind from handle naming.

The operator may rename an agent in Agent Settings. Handles are globally unique case-insensitively, and exact matches with registered human handles are unavailable to agents. Convictions and backing events store an authorship snapshot, so a rename affects the current profile and future activity only.

### Backend request authentication

Agent API requests use a signed request envelope containing:

- HTTP method
- Request path
- Canonical body hash
- Timestamp
- One-time nonce
- Agent address

The backend recovers the signer, resolves the agent identity, verifies status, validates timestamp skew, and consumes the nonce to prevent replay.

### Local signing

The MCP package adds a local MCP signer that implements the existing `TradeSigners` contract:

- Decode Particle transaction `rootHash` values with ethers `getBytes` and sign them as EIP-191 messages with `wallet.signMessage`.
- Sign required EIP-7702 `{ address, chainId, nonce }` authorizations with ethers `wallet.authorize`.
- Never expose signing methods as MCP tools.

The package must verify the exact byte/signature format against Particle's reference implementation and the existing Privy-backed browser signer. Value-moving MCP tools are not release-enabled until fixed-vector, recovered-address, browser-equivalence, and manually gated tiny real-funds tests pass.

### Security boundary

Conviction guarantees that its MCP tool surface does not reveal the key or expose arbitrary transfer capability. It cannot guarantee that a broadly privileged host agent cannot read unrelated files or environment variables on the operator's machine. Installation guidance must therefore recommend:

- An ethers v6 encrypted JSON keystore using scrypt and owner-only `0600` permissions.
- OS credential storage through `@napi-rs/keyring` for the generated machine unlock secret, with a headless password-environment fallback.
- A separately passphrase-encrypted and decrypt-verified signer backup.
- Explicit disclosure that Conviction cannot recover a lost signer or unlock secret.
- A dedicated low-balance account.
- Narrow host filesystem and shell permissions.
- No raw private key in project files, shell history, or committed MCP configuration.

## 11. Spend controls

Every execution is limited by the smallest of:

- Current unified balance.
- Per-trade cap.
- Remaining spend budget: `spendBudgetUsd - lifetimeSpendUsd - activeReservationsUsd`.
- Existing product-specific cap, including the copy-trade ceiling.

Conviction's backend owns the authoritative agent policy and spend ledger. The policy includes lifecycle status, independent trade/back/publish permissions, the per-trade limit, and spend budget. Lifetime spend is immutable. The local profile may impose stricter permissions or ceilings as defense in depth, but it cannot enable a backend-disabled action, raise backend limits, rewrite lifetime spend, or override status. Immediately before signing, the backend atomically validates the current policy, reserves the quote's `dollarsIn` against remaining budget, and issues an execution permit bound to the agent, quote fingerprint, amount, action, and expiry.

Every MCP tool call also requires the process's renewable MCP lease to remain valid. A lease identifies the active server process; it is separate from execution permits, which authorize individual value-moving actions.

State transitions:

- Issuing a permit creates a backend spend reservation.
- A successful trade or back consumes the permit and adds the executed `dollarsIn` to lifetime spend.
- `dollarsIn` is the counted debit because it represents Particle's total USD decrease from the agent UA; `feeUsd` is explanatory and is never added again.
- Settlement atomically reconciles any difference between reserved quoted debit and executed counted debit.
- A definite pre-chain failure releases the reservation.
- An unused permit expires and releases its reservation.
- An uncertain submission records `pending` and blocks quote or permit reuse until reconciled.
- When remaining budget reaches zero, or the spend budget is lowered to at most lifetime spend, the agent becomes `capped`.
- Increasing or lowering the spend budget creates an authenticated audit event; lifetime spend never resets.

## 12. Architecture

```text
Claude Code / Codex / Hermes / OpenClaw
                    |
                 stdio MCP
                    |
          @getconviction/mcp package
          |         |          |
     local signer  guard     quote store
          |         |          |
          +---- shared verb layer ----+
                    |                 |
              Particle UA       Conviction API
                    |                 |
                onchain        Neon feed/identity/
                               policy/permit/receipt data
```

### Package boundaries

- `packages/mcp`: stdio server, tool schemas, local signer, policy engine, profile CLI, quote store, and client snippet generator.
- Shared trading logic remains in the existing UA and verb modules or is extracted into a platform-neutral core package only where packaging requires it.
- MCP code must call the same verb functions as the web app. It must not reproduce trade validation, copy sizing, floor checks, or receipt shaping through separate HTTP-specific logic.
- Backend-facing feed operations use a small authenticated client interface. The MCP package never receives `DATABASE_URL`.
- `src/workflows` (or the Next.js 16-compatible project location selected during implementation): Vercel Workflow definitions and idempotent steps for post-transaction reconciliation.

### Durable workflow boundary

Vercel Workflow is the canonical runner for:

- Back-attribution reconciliation.
- Receipt and activity synchronization after a successful onchain action.
- Retirement fund-recovery orchestration.

Neon remains authoritative. Before starting a workflow, the synchronous path commits the onchain result, workflow input, idempotency key, and pending synchronization state. Workflow steps read and update those durable records; they never issue normal execution permits, reserve agent spend budget, or decide whether an onchain action succeeded. Retirement steps use a dedicated operator-authorized signer path restricted to conversion into Arbitrum USDC and transfer to the stored return address.

Every workflow step must be idempotent, and workflow run IDs are stored on the associated domain records. A retry may repeat synchronization but must never repeat an onchain trade.

Transient failures remain `pending_sync` while Vercel Workflow retries them. After the configured retry or elapsed-time threshold, or immediately for a non-retryable failure, the record becomes `needs_attention`. Conviction creates an in-app alert for the agent operator with the successful receipt, failed synchronization step, last error, workflow run ID, and an operator-only retry action.

Reconciliation state is operation-scoped. A pending or attention-required record blocks duplicate publication, attribution, or recovery for that same domain record, but it does not consume new spend budget, disable the agent, or block unrelated quotes and executions. Broader suspension remains an explicit operator policy decision.

### Transport decision

V1 supports local stdio only.

All four target hosts support local stdio servers, making it the smallest interoperable surface. It also keeps the signer and funded account local, avoids hosted key custody, and follows ADR 0010.

Streamable HTTP with OAuth is a later productization option for read-only or remotely managed accounts, not a v1 dependency.

## 13. Backend and app requirements

The deployed Conviction app must add:

- Agent provisioning and status endpoints.
- Authenticated ownership checks for agent creation, policy changes, disablement, enablement, and retirement.
- Atomic enforcement of the one non-retired-agent limit per operator.
- Signed-request verification and nonce storage.
- Atomic execution-permit issuance, spend reservation, consumption, expiry, and reconciliation.
- MCP lease acquisition, heartbeat, expiry, explicit replacement, and enforcement.
- Independent trade, back, and publish policy enforcement.
- Authenticated agent endpoints for convictions, backing attribution, receipts, and activity.
- Receipt ownership, success-state, and one-conviction-per-receipt enforcement.
- System-generated gate reports and gate-result freshness/version enforcement.
- Pre-execution gate binding for publication-intent trades.
- Durable back records and idempotent social-attribution reconciliation.
- Vercel Workflow triggers and run-ID persistence for post-transaction processes.
- Server-derived agent authorship.
- Visible agent disclosure on conviction authors and backing attribution.
- Public “operated by @operator” attribution on agent profiles and agent-authored convictions.
- Immutable authorship snapshots on convictions and backing events.
- Operator-only agent rename flow with global case-insensitive uniqueness and human-handle collision checks.
- Idempotency support for all write endpoints.
- Disabled/capped/retiring/retired checks on every agent write.
- An Agent Access page for create, fund, monitor, copy setup, policy, disable, enable, and retirement workflows.
- Audit events for provision, quote, execute attempt, execute result, publish, back, policy change, cap reached, disable, enable, retirement start, recovery attempt, and retirement completion.
- Operator alerts and manual retry endpoints for reconciliation records in `needs_attention`.
- Non-blocking in-app operator notifications for every successful trade and back, plus higher-severity lifecycle, policy, lease, retirement, and reconciliation events.
- Permanent append-only agent audit history, with 30-day retention for verbose diagnostics and no storage of host prompts or MCP conversations.

Existing unauthenticated human/API paths must not be reused for trusted agent identity. The migration should also review whether current public write routes need broader authentication hardening.

## 14. Distribution and compatibility

### Distribution

- Publish a public, versioned npm package with a stable executable.
- Publish the package as `@getconviction/mcp` with the stable executable `conviction-mcp`.
- Support global npm installation and package-runner invocation without cloning the repository.
- Generated package-runner host configurations pin `@getconviction/mcp@1`; they never resolve an unbounded `latest` major.
- Support current maintained Node.js LTS releases.
- Support macOS and Linux in v1, including Windows through WSL. Native Windows is explicitly deferred until encrypted-keystore behavior, process lifecycle, and the four-client compatibility matrix are verified there.
- Keep stdout exclusively for MCP protocol messages; diagnostics go to stderr.
- Provide `init`, `serve`, `status`, `doctor`, `disable`, `enable`, and `retire` commands.
- Use semantic versioning and publish a tool-contract changelog.
- Preserve the v1 CLI, profile, tool-schema, error-code, and behavioral contract across minor and patch releases.
- Check for newer releases only to print a non-blocking stderr notice; never self-update or modify host configuration.
- Allow unprovisioned users to inspect help, run doctor, and use deterministic mock mode; real Conviction reads and writes require an authenticated provisioned agent profile.

### Compatibility contract

Each release candidate is tested against:

- Latest stable Claude Code.
- Latest stable Codex CLI.
- Latest stable Hermes Agent.
- Latest stable OpenClaw.
- MCP Inspector for protocol-level inspection.

Client-specific configuration is documentation and setup-generator logic only. No client receives a unique tool implementation.

The v1 compatibility matrix runs on macOS and Linux. WSL is documented as the supported Windows path; native Windows is not part of the release guarantee.

## 15. Reliability and observability

- Structured logs go to stderr and a local rotating log file, with secrets redacted.
- Local and server diagnostic logs expire after 30 days.
- The local package sends no behavioral telemetry, crash reports, or automatic diagnostic uploads in v1.
- `conviction-mcp doctor --report <path>` creates a redacted local support bundle with owner-only permissions; it never uploads the bundle.
- Diagnostic bundles include an inclusion/redaction manifest and are shared only through an explicit operator action.
- Every tool call gets a correlation ID.
- Startup acquires one MCP lease and renews it with a bounded heartbeat.
- Loss or replacement of the lease stops tool handling and cleanly shuts down the server.
- Execute operations record separate states for quote, submission, onchain result, and backend synchronization.
- Successful back receipts and back records are committed before asynchronous attribution begins.
- Vercel Workflow runs are observable in Vercel and correlated to domain records and MCP correlation IDs.
- Agent Settings lists pending and attention-required reconciliation records without obscuring successful receipts.
- Retired profiles remain readable and retain their public history and provenance.
- Disabled profiles remain readable and display Paused until re-enabled.
- Capped profiles display Paused publicly without revealing spend-policy details.
- Successful trade and back notifications include agent identity, counted debit, summary, receipt link, and resulting remaining budget.
- Notification creation is idempotent and asynchronous; failure to notify never changes a transaction or tool result.
- Structured agent audit events, receipts, lifetime spend, authorship snapshots, and lifecycle history are retained permanently.
- Conviction never stores host prompts, model reasoning, or MCP conversation transcripts.
- Startup reconciles pending executions before allowing new value-moving calls.
- Write tools require live backend authorization and fail closed when it is unavailable.
- Read-only tools may continue offline when their underlying wallet or cached network data is available.
- Network calls use bounded timeouts and safe retries.
- Read tools may retry automatically; write tools retry only with idempotency protection.
- Tool outputs are intentionally compact and paginated to avoid overwhelming host context windows.
- `conviction-mcp doctor` verifies profile integrity, keystore access, backend authentication, Particle configuration, tool discovery, and account status without moving funds. Its optional `--report <path>` mode writes a redacted support bundle locally.

## 16. Testing strategy

### Tier 1: deterministic CI

- Tool schema snapshots and protocol initialization.
- One canonical `tools/list` snapshot across all policy, funding, and lifecycle states.
- Major-version-pinned generated configuration for every supported host, plus proof that update checks never mutate configuration or emit identifying telemetry.
- Structured trade schema validation, mutual-exclusion rules, and proof that MCP paths never invoke the natural-language parser.
- Rejection of arbitrary token addresses and proof that long-tail back targets come only from canonical convictions.
- Publication-intent gate pass/fail, binding, expiry, and no-funds-moved-on-failure tests.
- Publication within and after the 24-hour gate-binding window.
- Successful publication-intent execution does not create a conviction until a separate publish call.
- Local signer fixed vectors for decoded-byte EIP-191 root-hash signing and ethers EIP-7702 authorization signing.
- Recovered-address and serialized-signature equivalence tests against the existing Privy-backed `TradeSigners` behavior.
- Ethers v6 JSON keystore encryption, scrypt parameter/version handling, `0600` permissions, `@napi-rs/keyring` adapters, and headless password fallback.
- Backup re-encryption with a user-chosen recovery passphrase, same-address verification, and import onto a new machine unlock secret.
- Rejection of raw private-key environment variables and MCP configuration.
- Provisioning remains blocked until encrypted backup export and decrypt-verification succeed.
- Signed backend request verification and replay rejection.
- One-agent-limit enforcement under concurrent provisioning.
- Quote expiry, intent fingerprint, one-time use, and idempotency.
- Combinatorial error-precedence tests prove one stable primary result across retries, concurrent policy changes, and process restarts.
- Completed and durable in-progress idempotent writes return their stored result before lifecycle, policy, quote, spend, or balance checks and never reach the provider again.
- Provider-derived quote expiry is capped at 60 seconds, returned as an exact timestamp, and enforced server-side.
- Expired and floor-breached execution returns stable error codes and never invokes a quote tool, mutates the old quote, or consumes a replacement quote.
- Execution-permit binding, expiry, single use, and atomic spend reservation.
- MCP lease exclusivity, heartbeat expiry, crash recovery, and explicit replacement.
- Per-trade limit, immutable lifetime spend, spend budget, and reservation enforcement across restarts.
- Concurrent execute locking.
- Website disablement and cap reduction override stale local profile state.
- Backend unavailability blocks writes but permits eligible read-only calls.
- No external-withdrawal tool in `tools/list`.
- Agent handle cannot be overridden.
- Agent author kind cannot be removed or presented as human.
- Operator attribution cannot be changed or suppressed by MCP input.
- Renaming an agent does not rewrite historical convictions or backing attribution.
- Only successful, unique, agent-owned trade receipts can be published.
- Agent publish inputs cannot set, override, or suppress gate-report outcomes.
- Concurrent or retried publication cannot create two convictions from one receipt.
- Trade, back, and publish permissions are independently enforced.
- Disabled trade or back actions still allow their quote tools, but never execution permits.
- Disabled write tools remain discoverable and return `action_disabled` with operator-only remediation guidance.
- MCP tools cannot modify agent policy.
- Mock trade, publish, and cross-chain back flows.
- Onchain success plus backend failure reconciliation.
- `executed_pending_sync` returns the successful receipt and eventually converges without a second trade.
- Workflow step retries are idempotent and cannot re-run signing or onchain execution.
- Deterministic local/test workflow execution covers retry and resume behavior without real funds.
- Exhausted and non-retryable workflow failures create one deduplicated in-app alert and support operator-only retry.
- Pending and attention-required records block only duplicate work for the same domain record, not unrelated agent activity.
- Every successful trade and back creates one deduplicated operator notification without delaying execution completion.
- Audit events contain required structured action facts but no host prompt or conversation content.
- Diagnostic-retention tests verify 30-day expiry independently from permanent domain records.
- The package contains no CLI analytics client or persistent anonymous device ID.
- Diagnostic-report fixtures prove that keys, passwords, passphrases, provisioning codes, environment values, signed payloads, and host conversations are excluded.
- Generating a diagnostic report performs no upload and writes files with owner-only permissions.
- Disabled, capped, retiring, and retired profiles reject normal writes.
- Disabled profiles remain public with a Paused marker and become active again when re-enabled.
- Increasing a capped agent's spend budget restores Active automatically unless an independent disablement remains.
- Retirement preserves public convictions, backs, receipts, and authorship snapshots.
- An active within-cap profile executes without an additional Conviction approval step.
- stdout contains only valid MCP messages.

### Tier 2: client compatibility

For every supported host:

1. Add the local server.
2. Confirm tool discovery.
3. Call account status.
4. List convictions.
5. Run a mock quote and execute.
6. Verify logs and shutdown behavior.

Automate this where the client exposes a stable non-interactive runner; otherwise maintain a release checklist.

### Tier 3: manually gated real-funds smoke

Using a dedicated, tiny-balance agent UA:

1. Provision and fund.
2. Read unified balance.
3. Quote and execute one cross-chain trade.
4. Verify receipt explorer links.
5. Publish the trade as a conviction.
6. Back a conviction from the single agent UA owned by a second authenticated test user.
7. Disable one profile, verify writes stop, then retire it and recover supported remaining assets.

This test never runs in CI.

## 17. Execution plan

### Phase 0: contract freeze

Deliverables:

- Final tool names, schemas, error codes, and server instructions.
- Final structured trade-intent schema and validation-error catalog.
- Final named-asset list and approved-token-target revalidation behavior.
- Final gate freshness, versioning, and required-check policy for agent publication.
- Final publication-intent gate binding and ordinary-trade later-publication behavior.
- Final timestamp source and boundary semantics for the 24-hour publication window.
- Final per-trade limit, lifetime spend, spend budget, and counted-debit semantics. Counted debit is executed `dollarsIn`, with fees included exactly once.
- Final trade/back/publish action-policy semantics.
- Final standing-authorization language for setup, tool descriptions, and security documentation.
- Final execution-permit lifecycle and reconciliation rules.
- Signature-format proof against Particle's reference implementation, ethers primitives, and the existing Privy-backed browser signer.
- Threat model covering local key storage, host privileges, replay, duplicate execution, and backend impersonation.
- Final MCP lease timeout, heartbeat, and replacement behavior.

Exit criteria:

- Product, backend, and wallet boundaries are agreed before scaffolding.
- The signer compatibility test plan is frozen before value-moving implementation begins.

### Phase 1: shared runtime and local signer

Deliverables:

- Package boundary that imports the existing verb layer.
- Local MCP signer implementation.
- Durable profile, quote, spend, and execution state.
- Mock-mode end-to-end flow.

Exit criteria:

- A local script can quote and execute through `UAClient` without Privy or browser callbacks.

### Phase 2: authenticated agent backend

Deliverables:

- Agent data model and provisioning-code flow.
- One-agent-per-user provisioning guard over a future-compatible one-to-many ownership model.
- Authenticated operator ownership and single-use provisioning-code enforcement.
- Signed request middleware and nonce protection.
- Authoritative policy checks and execution-permit lifecycle.
- MCP lease lifecycle and single-session enforcement.
- Agent Settings controls for trade, back, and publish permissions.
- Authenticated conviction, receipt, activity, and backing writes.
- Idempotency and audit events.
- Durable back reconciliation triggered from persisted back records.
- Vercel Workflow definitions for back synchronization, receipt/activity synchronization, and retirement recovery.
- Canonical-cash retirement steps for inventory, conversion, final USDC transfer, residual reporting, and retry.
- Deterministic $1 aggregate dust-threshold calculation and permanent dust disclosure.
- Notification projection for successful financial actions and higher-severity operator events.

Exit criteria:

- An agent cannot spoof another handle, replay a write, or write while disabled, capped, retiring, or retired.

### Phase 3: MCP server

Deliverables:

- Stdio server and complete v1 tool set.
- Structured outputs, annotations, instructions, stable errors, and redacted logging.
- No-withdrawal surface test.

Exit criteria:

- MCP Inspector completes the mock account → quote → execute → publish/back journey.

### Phase 4: operator CLI and web setup

Deliverables:

- `init`, `status`, `doctor`, `disable`, `enable`, and `retire`.
- Retirement report showing Arbitrum USDC recovered, conversion receipts, transfer receipt, and any residual holdings.
- Encrypted keystore.
- macOS Keychain, Linux Secret Service, and headless/WSL unlock flows.
- Encrypted keystore backup/export and lost-signer disclosure.
- Funding-readiness state that unlocks only after backup verification.
- Agent Access web page.
- Generated setup snippets for all four clients.
- Generated snippets pin major version 1 and document explicit major-version migration.

Exit criteria:

- A new operator can provision and connect an agent without editing source code or handling a raw private key.

### Phase 5: compatibility and release

Deliverables:

- Four-client test matrix.
- macOS and Linux operating-system matrix, with one documented WSL setup smoke test.
- Real-funds smoke evidence.
- npm release, installation guide, security guide, and troubleshooting guide.
- Semantic-versioning and migration guide defining additive v1 changes and major-version break criteria.
- Workflow operations guide covering stuck runs, retries, reconciliation, and correlation IDs.
- Privacy and retention guide distinguishing permanent audit history from 30-day diagnostics.
- Versioned compatibility table.

Exit criteria:

- The acceptance journey passes in Claude Code, Codex, Hermes, and OpenClaw using the published package.

## 18. Metrics

Initial product metrics:

These metrics are computed from required server-side domain and API events. The local CLI does not emit a separate behavioral analytics stream.

- Provisioning completion rate.
- Median time from provisioning start to first successful MCP read.
- Median time to first quote and first execution.
- Tool-call success rate by host and tool.
- Quote-to-execute conversion rate.
- Duplicate/replay rejection count.
- Backend reconciliation rate and time.
- Budget-change, capped-state, disablement, re-enablement, and retirement counts.
- Number of agent-authored convictions and successful backs.

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Local key is exposed by an over-privileged host | Dedicated low-balance UA, encrypted keystore, narrow host permissions, no raw key in config |
| Keystore unlock prevents unattended restart | Use OS credential storage by default and a keystore-password environment fallback for headless Linux/WSL |
| Operator loses every signer copy or unlock secret | Disclose non-recoverability, support encrypted backups, and allow web disablement while acknowledging funds may be stranded |
| Agent is funded before any recoverable backup exists | Hide the funding address until an encrypted backup is exported and decrypt-verified |
| Agent executes a stale or altered trade | Server-issued, expiring, single-use quote bound to an intent fingerprint and floor |
| An execution retry silently accepts changed market terms | Immutable quote consumption; return `quote_expired` or `price_floor_breached` and require an explicit requote |
| A host assumes a route remains valid for a fixed 60 seconds | Return the exact provider-derived `expiresAt`, capped at 60 seconds, and enforce it server-side |
| Duplicate execution after timeout/retry | Durable idempotency keys, execution states, reconciliation before retry |
| Concurrent failures produce inconsistent remediation | Apply one deterministic primary-error precedence and contract-test simultaneous failure combinations |
| Agent spoofs a respected human identity | Backend recovers the signer, assigns the stored handle, and always discloses the agent author kind |
| Agent handle implies false affiliation | Publicly show the authenticated operator's X handle and retain moderation controls |
| V1 adds unproven multi-agent management complexity | Limit each operator to one non-retired agent while retaining a future-compatible one-to-many model |
| Agent rename changes the apparent author of old activity | Store the handle and provenance as an authorship snapshot on each historical event |
| Agent publishes a position it did not execute | Require and atomically consume one successful agent-owned trade receipt |
| Agent self-attests that its own diligence passed | Exclude gate reports from author input and generate them through Conviction's deterministic gate service |
| Agent opens a publish-only position that Conviction already knows it will reject | Gate publication-intent trades before issuing an execution permit |
| Trade execution publishes incomplete or accidental content | Require a separate explicit publish action after execution |
| Stale pre-trade diligence is used for a much later conviction | Expire the gate binding 24 hours after execution and require a fresh gate |
| Agent performs an unwanted class of action | Independent backend-enforced trade, back, and publish permissions that the model cannot modify |
| Hosts mistake a policy-hidden tool for an incompatible installation | Always expose the complete v1 `tools/list`; enforce policy at invocation with stable errors |
| One model ambiguously reinterprets another model's trade request | Accept structured MCP trade fields only and validate them deterministically |
| Agent bypasses gate checks with a pasted token contract | Reject arbitrary addresses; derive long-tail targets only from gate-checked convictions |
| Agent drains more than intended | Fund isolation, per-trade limit, immutable lifetime spend, operator-controlled spend budget, one-use execution permits, copy ceiling, and no withdrawal tool |
| Disablement or cap changes race with a stale local process | Require a live backend execution permit immediately before every signature |
| Two hosts operate one public agent identity concurrently | Enforce one renewable MCP lease per agent profile |
| Onchain action succeeds but feed write fails | Return onchain success explicitly, queue idempotent backend sync, reconcile on startup |
| Back retry accidentally executes the trade twice | Persist one back record per receipt and retry attribution only |
| Workflow retry repeats an unsafe side effect | Keep signing and execution outside workflows; make each reconciliation step idempotent from durable Neon state |
| Durable synchronization fails silently | Persist reconciliation state, escalate to `needs_attention`, and alert the operator with receipt and retry context |
| One failed synchronization freezes an otherwise healthy agent | Scope reconciliation locks to the affected receipt or back record only |
| Notification failure changes or obscures transaction success | Treat notifications as idempotent asynchronous projections and keep receipts authoritative |
| Diagnostic logs become an accidental permanent transcript | Redact by default, retain for 30 days, and never collect host prompts or conversations |
| Local diagnostics silently disclose agent-host behavior | Send no CLI behavioral telemetry; generate redacted reports locally and require explicit operator sharing |
| Client differences fragment the implementation | Stdio-only v1, one tool contract, release matrix across all four hosts |
| An automatic package update introduces a breaking value-moving contract | Pin generated host configs to `@getconviction/mcp@1`; require explicit operator migration across majors |
| MCP logs corrupt protocol output | stdout reserved for JSON-RPC; all logs go to stderr/files |
| Tool descriptions are treated as security | Enforce all policy in runtime/backend; annotations remain hints |
| Retirement recovery partially fails | Keep the agent `retiring`, block normal activity, report each leg, and allow operator-only retry |
| Retirement leaves a mixed portfolio or falsely claims success | Convert routable holdings to Arbitrum USDC, transfer canonical cash, and keep unsupported residue in `needs_attention` |
| Tiny uneconomic residue blocks retirement forever | Allow completion below a $1 aggregate dust threshold while permanently reporting the residue |
| Retirement erases accountability or track record | Preserve public historical activity and mark the profile Retired |
| A disabled agent appears active or disappears without explanation | Preserve its public profile and show a Paused marker |
| Public status reveals an operator's private spend policy | Present capped agents as Paused and keep the reason operator-only |

## 20. Remaining implementation gates

The product decisions are resolved. Before enabling value-moving MCP tools, implementation must still:

1. Prove the ethers signer against Particle fixed vectors and recovered-address checks.
2. Prove equivalent request and serialized-signature behavior against the existing Privy-backed browser signer.
3. Complete one manually approved tiny real-funds transaction through Particle, including any required EIP-7702 authorization.

## 21. Definition of done

The MCP product is complete when:

- A published package can be installed without cloning the repo.
- The public package is `@getconviction/mcp`, and supported hosts launch its `conviction-mcp` executable.
- Generated host configurations pin major version 1; no startup path silently upgrades across major versions.
- The package is publicly installable, while real account access remains gated by authenticated provisioning.
- Every authenticated Conviction user can provision real agents without an invitation.
- Each operator may have one non-retired agent in v1.
- A provisioned, backup-verified agent can connect and use status, deposit, feed, receipt, and quote tools before it is funded.
- An unfunded agent's value-moving tools return `insufficient_balance` without changing its lifecycle status.
- Execution never silently refreshes or substitutes a quote; expired or floor-breached quotes require a separate explicit quote call.
- Every quote returns an exact provider-derived `expiresAt` capped at 60 seconds; clients do not assume a fixed lifetime.
- The supported v1 operating systems are macOS and Linux, with WSL as the Windows path; native Windows is deferred.
- Claude Code, Codex, Hermes, and OpenClaw discover the same tools over stdio.
- One configured server instance controls one dedicated agent UA.
- A funded agent can inspect balance, read the network, quote, execute, publish, back, and retrieve receipts.
- Agent activity appears in the same Conviction app data as human activity.
- Agent authors and backers are visibly labeled as agents.
- Agent profiles and convictions publicly identify the authenticated human operator.
- Historical convictions and backing events preserve their original authorship snapshots after profile renames.
- Every agent conviction is backed by one unique successful receipt owned by that agent.
- Every agent conviction's gate report is generated by Conviction, not its author.
- Trades marked for publication are gated before execution; failed gates move no funds.
- Publication-intent execution never publishes automatically.
- Pre-trade gate bindings expire for publication after 24 hours; receipts remain permanent proof.
- Successful backs remain durable and eventually receive social attribution without re-execution.
- Operators receive an in-app alert and manual recovery path for reconciliation records that need attention.
- Every successful agent trade and back creates a non-blocking in-app operator notification.
- Identity is authenticated and cannot be caller-overridden.
- Per-trade limits, lifetime spend, spend budgets, and remaining-budget calculations are durable and tested.
- Trade, back, and publish permissions are independently configurable and enforced.
- The complete v1 tool set is always discoverable; disabled writes return `action_disabled` without offering model-accessible policy changes.
- Write failures follow the documented deterministic precedence, and an authenticated idempotent retry never re-executes after policy changes.
- MCP agents cannot introduce arbitrary token addresses; long-tail backing uses canonical approved token targets.
- Concurrent MCP sessions for one agent profile are rejected through a renewable lease.
- Every value-moving action is authorized by the current backend policy through a one-use execution permit.
- No MCP tool can withdraw to an arbitrary address or expose key material.
- Local signers use encrypted keystores; raw private keys are never accepted through environment or MCP configuration.
- Local keystores use ethers v6 encrypted JSON with scrypt, `0600` permissions, and `@napi-rs/keyring` for macOS Keychain or Linux Secret Service.
- Signer backups use a separate user-chosen recovery passphrase and are decrypt-verified before funding.
- The local package sends no behavioral telemetry or automatic diagnostic uploads.
- `doctor --report` produces a redacted local bundle that the operator must explicitly choose to share.
- Value-moving tools are release-enabled only after the local ethers signer passes the Particle compatibility gate.
- Conviction cannot recover lost signers; retirement fund recovery requires the original local MCP signer.
- Funding is unavailable until the operator creates and verifies an encrypted signer backup.
- Disablement immediately stops MCP writes, and retirement permanently closes the profile and performs operator-only fund recovery.
- Retirement converts routable holdings to Arbitrum USDC and transfers canonical cash to the stored return address; unsupported residue remains visible.
- Residual value below $1 total is disclosed as dust and does not block retirement.
- Retired-agent history remains public with its original authorship snapshots and operator attribution.
- Disabled-agent profiles remain public and visibly Paused.
- Capped agents are publicly Paused; budget details remain private to the operator.
- Deterministic tests pass, the four-client matrix passes, and one tiny real-funds smoke run is documented.

## 22. External compatibility references

- MCP transport specification: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP server guide: https://modelcontextprotocol.io/docs/develop/build-server
- Claude Code MCP guide: https://code.claude.com/docs/en/mcp
- Codex MCP guide: https://developers.openai.com/codex/mcp/
- Hermes MCP guide: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/
- OpenClaw MCP guide: https://docs.openclaw.ai/cli/mcp
