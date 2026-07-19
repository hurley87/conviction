# Publish the MCP package as `@getconviction/mcp`

The public npm package is named `@getconviction/mcp`, and its stable executable is `conviction-mcp`.

The npm organization scope is `getconviction` because the `@conviction` scope was already taken on the public registry. The scoped package keeps ownership and discovery tied to Conviction while leaving room for future sibling packages. The unscoped executable gives Claude Code, Codex, Hermes, OpenClaw, shell users, and generated configuration snippets one short, consistent command.

## Consequences

- Installation uses `npm install --global @getconviction/mcp` or an equivalent package-runner command.
- MCP host configurations launch `conviction-mcp serve --profile <name>`.
- Generated package-runner host configurations pin major version 1 under ADR 0046.
- Documentation, changelogs, and operator-generated support diagnostics use these names consistently.
- The package manifest maps the `conviction-mcp` binary to the CLI entrypoint.
- Renaming either surface after launch is considered a breaking distribution change requiring a migration alias and deprecation period.
