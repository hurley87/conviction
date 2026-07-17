# Agent funding and caps are standing authorization

An active agent UA may execute a valid quote without a fresh human confirmation inside Conviction. The operator grants standing authorization by provisioning and funding the dedicated account with an explicit per-trade limit and spend budget; every execution is still bound to a short-lived, single-use quote and the runtime's policy checks. We rejected Conviction-level confirmation on every trade because it would prevent autonomous Hermes, OpenClaw, and unattended MCP workflows, while host-level approval prompts remain available to operators who want them.

## Consequences

- Human app trades still require the confirm-card flow from ADR 0011; this decision applies only to provisioned agent UAs.
- Funding, caps, status, quote validity, disablement, and retirement are the hard consent boundary.
- MCP tool descriptions must state that execution moves real funds without requesting another Conviction confirmation.
