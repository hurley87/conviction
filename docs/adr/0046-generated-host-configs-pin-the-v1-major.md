# Generated host configs pin the v1 major

Generated MCP host configurations invoke `@conviction/mcp@1`, or an equivalent installation pinned to major version 1. They may receive compatible minor and patch releases within v1, but they never automatically cross a major-version boundary.

The package follows semantic versioning for its CLI, profile format, MCP tool names, input and output schemas, error codes, and behavioral contract. A major upgrade requires an explicit operator action and migration guidance. The CLI may check npm metadata and print a non-blocking update notice to stderr, but it does not self-update or modify host configuration.

We rejected unpinned `latest` configuration because a breaking MCP contract change could silently alter a value-moving integration at process startup. We also rejected exact-version pinning in generated configs because it would prevent operators from receiving compatible security and reliability fixes within v1.

## Consequences

- Generated package-runner snippets use a major pin such as `@conviction/mcp@1`.
- Global-install instructions recommend installing or updating within the v1 major.
- Minor and patch releases must preserve the v1 MCP contract or provide backward-compatible additive behavior.
- Tool removal, required-field changes, error-semantic changes, incompatible profile migrations, or changed signing behavior require a new major version.
- Update checks contain only the installed version and public registry metadata request; they do not identify the operator, agent, host, or machine.
- The update notice is advisory and never blocks startup or execution.
