# Conviction MCP security

Authoritative product rules: [docs/mcp-server-prd.md](./mcp-server-prd.md), ADRs 0007, 0020, 0031, 0043–0047.

## Boundaries

- One local encrypted signer per agent; Conviction cannot reconstruct it.
- Backend is authoritative for budget, action policy, leases, and permits.
- Quote-before-execute for every value-moving tool.
- No withdrawal-shaped tool, no arbitrary destinations, no private-key MCP tools.
- Disable is reversible; retirement recovers canonical cash with the original signer.

## Local diagnostics

- Stdout is MCP protocol only.
- Stderr + `~/.conviction/logs` hold redacted diagnostics (30-day retention).
- Doctor `--report` writes a local redacted bundle and never uploads it (ADR 0044).
