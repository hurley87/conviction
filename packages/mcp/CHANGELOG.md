# Changelog

All notable changes to `@getconviction/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Tool-contract changes that break host compatibility require a **major** bump
(ADR 0046). Minor and patch releases preserve the current major's tool names,
schemas, and safety boundaries.

## [2.0.0] - 2026-07-19

### Changed

- **Breaking:** value-moving tools expose an explicit execution finality
  lifecycle: `submitted`, `pending`, `finalized`, `partial`, `failed`, and
  `needs_attention`. Only `finalized` returns success or a publishable
  receipt; Particle submission acceptance is `submitted`, not success.
- **Breaking:** `conviction_get_receipt` returns lifecycle evidence for
  unresolved executions (`outcome`, nullable `receipt`/`entryAt`, and
  `execution` with per-leg status). Explorer links and confirmed hashes appear
  only for finalized legs.
- **Breaking:** `conviction_execute_trade` and `conviction_back_conviction`
  advertise `executeOutputSchema` and return non-success lifecycle results for
  non-finalized outcomes. Same-key retries reconcile without re-signing or
  resubmitting.
- Generated host pins move to `@getconviction/mcp@2`.

### Added

- Operator skill and README guidance for finality outcomes and safe recovery
  (inspect via `conviction_get_receipt`; review Agent Access for `partial`,
  `failed`, or `needs_attention`).
- Deterministic mock lifecycle fixtures (`mock-execution-pending`,
  `mock-execution-partial`) aligned with the live contract.

## [1.0.0] - 2026-07-19

### Changed

- Published npm scope is `@getconviction/mcp` (npm org `getconviction`); the
  `@conviction` registry scope was unavailable. Generated host pins use
  `@getconviction/mcp@1`. The `conviction-mcp` executable name is unchanged.

### Added

- Public `conviction-mcp` executable with `init`, `serve`, `doctor`, `status`,
  `disable`, `enable`, and `retire` commands.
- Major-pinned host configuration for Claude Code, Codex CLI, Hermes Agent,
  OpenClaw, and MCP Inspector (`@getconviction/mcp@1`).
- Live and mock MCP tool contract (ADR 0047):
  - `conviction_account_status`
  - `conviction_list_convictions`
  - `conviction_get_conviction`
  - `conviction_summarize_feed`
  - `conviction_get_receipt`
  - `conviction_quote_trade`
  - `conviction_execute_trade`
  - `conviction_publish_conviction`
  - `conviction_quote_back`
  - `conviction_back_conviction`
- Local encrypted keystore signer with OS keyring / headless unlock.
- Quote-before-execute, lease exclusivity, and policy-bounded writes.
- Doctor checks for profile, keystore, Particle config, tool discovery, auth,
  and account status (no funds moved).
- Optional redacted local support reports (never uploaded).
- Stderr + rotating local diagnostic logs under `~/.conviction/logs` with
  per-tool correlation IDs.

### Security

- No withdrawal-shaped tool, no private-key MCP exposure, no identity spoofing
  inputs, and no arbitrary destination/token fields on write tools.
