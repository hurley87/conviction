# Conviction MCP security

Authoritative product rules: [docs/mcp-server-prd.md](./mcp-server-prd.md), ADRs 0007, 0020, 0031, 0043–0047.

## Boundaries

- One local encrypted signer per agent; Conviction cannot reconstruct it.
- Backend is authoritative for budget, action policy, leases, and permits.
- Quote-before-execute for every value-moving tool.
- Particle submission acceptance is `submitted`, never success. Only confirmed
  `finalized` executions can create receipts, become publishable, or count as
  recovered retirement value.
- Reconciliation is read-only and at-most-once signing/submission is preserved:
  same-key retries never re-sign or resubmit.
- No withdrawal-shaped tool, no arbitrary destinations, no private-key MCP tools.
- Disable is reversible; retirement recovers canonical cash with the original signer.

## Local diagnostics

- Stdout is MCP protocol only.
- Stderr + `~/.conviction/logs` hold redacted diagnostics (30-day retention).
- Doctor `--report` writes a local redacted bundle and never uploads it (ADR 0044).

## Finality evidence boundary

Agent-facing lifecycle output may include normalized provider status, attempt
counts, workflow IDs, affected legs, confirmed hashes and explorer links, and
safe recovery guidance. It never includes raw provider payloads, signatures,
signer material, credentials, or planned/unconfirmed userOp hashes. Explorer
links are derived only from hashes confirmed for finalized legs.

Spend reservations remain held while an execution is `submitted`, `pending`,
`partial`, or `needs_attention`. A definite all-leg failure can release the
reservation; finalized accounting commits it once. Retirement likewise remains
`retiring` until conversion, return transfer, destination receipt, and residual
checks are confirmed.
