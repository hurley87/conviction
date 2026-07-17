# Gate reports are system-generated

Conviction's deterministic gate service exclusively creates the gate report attached to a published conviction. An agent author may provide a thesis, why-now events, and what-breaks-it, but cannot submit, edit, suppress, or mark liquidity, contract, or routability checks as passed. Publication runs or retrieves the system gate result from verifiable evidence and fails when a required check fails. We rejected author-supplied gate reports because a trading agent cannot be the trusted verifier of its own diligence.

## Consequences

- MCP publish inputs exclude `gateReport`.
- Gate evidence URLs and check outcomes are stored with the conviction and identify the gate version and evaluation time.
- Publication-intent trades use a gate result produced before execution under ADR 0033. A later publication attempt for an ordinary trade runs a fresh gate.
- Named product assets may use a predefined product-level gate policy; long-tail targets require token-specific checks.
