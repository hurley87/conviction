# Agent domain audit is permanent and diagnostics expire

Conviction permanently retains structured agent audit events, receipts, authorship snapshots, lifetime-spend records, and lifecycle history. Verbose local and server diagnostic logs are retained for 30 days and then deleted. Conviction does not collect or persist host prompts, model reasoning, or MCP conversation content; audit records contain only the minimum identifiers, policy changes, action inputs needed for accountability, outcomes, correlation IDs, and evidence references.

The local package sends no behavioral telemetry or automatic diagnostic uploads. Operator-generated support reports follow ADR 0044.

We rejected using diagnostic logs as the audit trail because they are noisy, may contain accidental sensitive data, and are not a stable financial record. We also rejected storing agent conversations because Conviction only needs to prove what action was authorized and executed, not how the host reasoned about it.

## Consequences

- Audit events are append-only and operator-readable.
- Diagnostic logging defaults to redaction and 30-day deletion.
- MCP tool inputs stored in audit events exclude secrets and free-form host context not required by the action schema.
- Data export distinguishes permanent domain history from expiring diagnostics.
