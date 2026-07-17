# Conviction MCP

`@conviction/mcp` is Conviction's local stdio Model Context Protocol server. The
package is TypeScript-first; published artifacts are compiled to `dist/`. Current
surfaces:

- deterministic mock mode for host integration without credentials
- `init` to redeem a one-time Agent Access handoff into a local encrypted profile
- `serve --profile` for one authenticated live MCP session with a renewable lease

## Provision a local profile

After Agent Access creates a pending agent, redeem the handoff locally:

```sh
conviction-mcp init \
  --code <one-time-code> \
  --backup-path ~/conviction-signer.backup.json \
  --api-base https://your-conviction-host
```

`init` generates an ethers v6 encrypted keystore on the machine, proves
possession of the public address to Conviction, exports a separately
passphrase-encrypted backup, decrypt-verifies that backup, then marks the agent
funding-ready. The private key never leaves the local process.

Headless unlock uses `CONVICTION_KEYSTORE_PASSWORD`. Recovery passphrase may be
passed with `--backup-passphrase` or `CONVICTION_BACKUP_PASSPHRASE`. Raw private
key environment variables are rejected.

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

## Start a live authenticated session

After `init` writes a local profile:

```sh
conviction-mcp serve --profile <name> --api-base https://your-conviction-host
```

Startup acquires one renewable MCP lease for that agent. A second concurrent
process is rejected with the active lease age and expiry. Use `--replace-lease`
only when intentionally displacing the other process. Live mode authenticates
backend requests with the local signer and never exposes signing methods as MCP
tools. Headless unlock uses `CONVICTION_KEYSTORE_PASSWORD`.

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
