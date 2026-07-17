# CLI telemetry is off and support reports are operator-shared

The `@conviction/mcp` package sends no behavioral telemetry or automatic diagnostic uploads in v1. It does not report commands run, tools called, host identity, timing, errors, machine characteristics, or feature usage through a separate analytics channel.

`conviction-mcp doctor --report <path>` generates a redacted diagnostic bundle locally. The operator can inspect the bundle and must explicitly choose whether and how to share it with Conviction support. Generating a report never uploads it, opens a network submission, or enables future telemetry.

The report may contain package and runtime versions, operating-system family, profile and keystore health results, credential-store availability, MCP discovery results, backend reachability, stable error codes, recent correlation IDs, and redacted log excerpts. It excludes private keys, keystore passwords, recovery passphrases, credential-store values, provisioning codes, signed payloads, full addresses where unnecessary, host prompts, model reasoning, MCP conversations, and environment-variable values.

We rejected default opt-out analytics because this process handles signing authority and may run inside highly privileged agent hosts. We also rejected automatic crash uploads because operators must retain control over diagnostic disclosure.

## Consequences

- Product metrics are derived from normal server-side domain and API events required to operate Conviction, not from a separate CLI analytics SDK.
- The CLI contains no telemetry client or persistent anonymous device identifier in v1.
- `doctor --report` writes only to an operator-selected local path with owner-only permissions.
- The bundle includes a manifest explaining every included file and redaction applied.
- Tests scan generated reports for known secret fixtures and fail if any are present.
- Support documentation tells operators to review the bundle before sharing it.
