# Install Conviction MCP

Primary guide: [packages/mcp/README.md](../packages/mcp/README.md).

## Quick path

```sh
npx -y @conviction/mcp@1 --help
```

1. Create a pending agent in Agent Access.
2. `conviction-mcp init --code <handoff> --backup-path ~/conviction-signer.backup.json --api-base <host>`
3. `conviction-mcp doctor --profile <name> --api-base <host>`
4. Paste the generated host snippet (major pin `@conviction/mcp@1`).
5. Fund the Universal Account only after doctor records setup verification.

Setup contract version is shared by CLI, UI, and `skills/conviction-mcp-setup`.
