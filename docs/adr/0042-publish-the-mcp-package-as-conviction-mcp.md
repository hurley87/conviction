# Publish the MCP package as `@conviction/mcp`

The public npm package is named `@conviction/mcp`, and its stable executable is `conviction-mcp`.

The scoped package keeps ownership and discovery tied to the Conviction organization while leaving room for future sibling packages. The unscoped executable gives Claude Code, Codex, Hermes, OpenClaw, shell users, and generated configuration snippets one short, consistent command.

## Consequences

- Installation uses `npm install --global @conviction/mcp` or an equivalent package-runner command.
- MCP host configurations launch `conviction-mcp serve --profile <name>`.
- Generated package-runner host configurations pin major version 1 under ADR 0046.
- Documentation, changelogs, and operator-generated support diagnostics use these names consistently.
- The package manifest maps the `conviction-mcp` binary to the CLI entrypoint.
- Renaming either surface after launch is considered a breaking distribution change requiring a migration alias and deprecation period.
