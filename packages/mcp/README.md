# Conviction MCP

`@conviction/mcp` is Conviction's local stdio Model Context Protocol server. The
first package slice provides a deterministic mock mode for validating package,
transport, and host integration without an account, credentials, signer, or
funds.

## Start mock mode

Run the v1-major-pinned package directly:

```sh
npx -y @conviction/mcp@1 serve --mock
```

The process speaks MCP over stdio. Its stdout is reserved for protocol messages;
startup diagnostics go to stderr.

From this repository, use:

```sh
npm run mcp:mock
```

## Connect Codex

Add the mock server as a local stdio MCP server:

```sh
codex mcp add conviction -- npx -y @conviction/mcp@1 serve --mock
```

The equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.conviction]
command = "npx"
args = ["-y", "@conviction/mcp@1", "serve", "--mock"]
```

After restarting Codex, list tools and call
`conviction_mock_interaction` with `{ "scenario": "success" }`. It returns:

```json
{
  "ok": true,
  "mode": "mock",
  "code": "mock_success",
  "message": "Conviction MCP mock interaction completed.",
  "interactionId": "mock-interaction-001"
}
```

Use `{ "scenario": "error" }` to validate the stable structured error path.

## Mock-mode safety

Mock mode is intentionally self-contained. It does not read live credentials or
private-key environment variables, generate a signer, write a profile or
keystore, call Conviction or Particle services, or move funds.
