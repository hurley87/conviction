# Install Conviction MCP

Primary guide: [packages/mcp/README.md](../packages/mcp/README.md).

## Quick path

```sh
npx -y @getconviction/mcp@2 --help
```

1. Create a pending agent in Agent Access.
2. Copy the complete init command (includes `--backup-path` and `--api-base`). Paste and run it; the CLI prompts for a recovery passphrase.
3. Successful init prints host configs and auto-runs doctor. Paste a major-pinned host snippet (`@getconviction/mcp@2`).
4. Fund the Universal Account only after doctor records setup verification.

If you leave Agent Access before copying the command, use **Regenerate handoff** (valid for 24 hours until init completes).

Setup contract version is shared by CLI, UI, and `skills/conviction-mcp-setup`.
