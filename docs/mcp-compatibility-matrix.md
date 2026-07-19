# MCP compatibility matrix (v1)

Release checklist for `@getconviction/mcp@1` (issue #61 / PRD §14 / ADR 0046).

## Platforms

| Platform | Status | Evidence |
| --- | --- | --- |
| macOS (Node 20 LTS) | Supported | CI `macos-latest` + manual RC |
| Linux (Node 20 LTS) | Supported | CI `ubuntu-latest` + manual RC |
| Windows via WSL | Supported (documented) | Manual smoke — fill after run |
| Native Windows | Deferred | Not a v1 release guarantee |

## Hosts (Tier 2)

Run generated configs from `conviction-mcp init` / doctor (major pin `@getconviction/mcp@1`).

For each host: add server → `tools/list` shows full v1 contract → account status / mock quote+execute → clean shutdown. Stdout must remain MCP protocol only.

| Host | Version | OS | Result | Notes |
| --- | --- | --- | --- | --- |
| Claude Code | | | | |
| Codex CLI | | | | |
| Hermes Agent | | | | |
| OpenClaw | | | | |
| MCP Inspector | | | | |

## Post-merge publish

Merge to `main` does not publish npm. After version + CHANGELOG land on `main`:

```sh
git tag mcp-vX.Y.Z
git push origin mcp-vX.Y.Z
# or: workflow_dispatch on publish-mcp.yml with dry_run=false
```

Requires `NPM_TOKEN` repository secret. Full maintainer checklist:
[`.cursor/skills/publish-getconviction-mcp/SKILL.md`](../.cursor/skills/publish-getconviction-mcp/SKILL.md).
See also [packages/mcp/CHANGELOG.md](../packages/mcp/CHANGELOG.md).
