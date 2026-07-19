# MCP compatibility matrix (v1)

Release checklist for `@conviction/mcp@1` (issue #61 / PRD §14 / ADR 0046).

## Platforms

| Platform | Status | Evidence |
| --- | --- | --- |
| macOS (Node 20 LTS) | Supported | CI `macos-latest` + manual RC |
| Linux (Node 20 LTS) | Supported | CI `ubuntu-latest` + manual RC |
| Windows via WSL | Supported (documented) | Manual smoke — fill after run |
| Native Windows | Deferred | Not a v1 release guarantee |

## Hosts (Tier 2)

Run generated configs from `conviction-mcp init` / doctor (major pin `@conviction/mcp@1`).

For each host: add server → `tools/list` shows full v1 contract → account status / mock quote+execute → clean shutdown. Stdout must remain MCP protocol only.

| Host | Version | OS | Result | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | | | | |
| Codex CLI | | | | |
| Hermes Agent | | | | |
| OpenClaw | | | | |
| MCP Inspector | | | | |

## Post-merge publish

```sh
git tag mcp-v1.0.0
git push origin mcp-v1.0.0
# or: workflow_dispatch on publish-mcp.yml with dry_run=false
```

Requires `NPM_TOKEN` repository secret. See [packages/mcp/CHANGELOG.md](../packages/mcp/CHANGELOG.md).
