# Conviction MCP

`@conviction/mcp` is Conviction's local stdio Model Context Protocol server. The
package is TypeScript-first; published artifacts are compiled to `dist/`. Current
surfaces:

- deterministic mock mode for host integration without credentials
- `init` to redeem a one-time Agent Access handoff into a local encrypted profile
- `doctor` / `status` for non-value-moving connection checks
- `serve --profile` for one authenticated live MCP session with a renewable lease
- public Agent Skills setup guide at `skills/conviction-mcp-setup/`

Setup contract version `1` is shared by the CLI, Agent Access UI, and the skill.

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
passphrase-encrypted backup, decrypt-verifies that backup, then prints
major-pinned host configuration for Claude Code, Codex, Hermes, and OpenClaw.
The private key never leaves the local process.

Headless unlock uses `CONVICTION_KEYSTORE_PASSWORD`. Recovery passphrase may be
passed with `--backup-passphrase` or `CONVICTION_BACKUP_PASSPHRASE`. Raw private
key environment variables are rejected.

## Verify locally before funding

```sh
conviction-mcp doctor --profile <name> --api-base https://your-conviction-host
```

Doctor checks profile integrity, keystore access, backend authentication, and
account status without moving funds. On success it records setup verification
and only then suggests funding. Optional `--report <path>` writes a redacted
local support bundle and never uploads it.

```sh
conviction-mcp status --profile <name>
```

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

After `init` writes a local profile and `doctor` succeeds:

```sh
conviction-mcp serve --profile <name> --api-base https://your-conviction-host
```

Startup acquires one renewable MCP lease for that agent. A second concurrent
process is rejected with the active lease age and expiry. Use `--replace-lease`
only when intentionally displacing the other process. Live mode authenticates
backend requests with the local signer and never exposes signing methods as MCP
tools. Headless unlock uses `CONVICTION_KEYSTORE_PASSWORD`.

## Connect a host

Every supported host launches the same shared MCP contract through the
major-pinned package runner. Replace `<name>` with your local profile name.

### Claude Code

```sh
claude mcp add conviction -- npx -y @conviction/mcp@1 serve --profile <name>
```

### Codex

```sh
codex mcp add conviction -- npx -y @conviction/mcp@1 serve --profile <name>
```

The equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.conviction]
command = "npx"
args = ["-y", "@conviction/mcp@1", "serve", "--profile", "<name>"]
```

### Hermes

Add under `mcp_servers` in `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  conviction:
    command: "npx"
    args:
      - "-y"
      - "@conviction/mcp@1"
      - "serve"
      - "--profile"
      - "<name>"
```

### OpenClaw

```sh
openclaw mcp add conviction -- npx -y @conviction/mcp@1 serve --profile <name>
```

## Platforms

- macOS: supported
- Linux: supported
- Windows through WSL: supported
- Native Windows: deferred

## Agent-readable setup skill

Install or read `skills/conviction-mcp-setup/SKILL.md` before connecting the MCP
server. The skill explains installation, host configuration, diagnostics, and
when operator action is required. It cannot provision, fund, change policy, or
access secrets.

## Mock-mode safety

Mock mode is intentionally self-contained. It does not read live credentials or
private-key environment variables, generate a signer, write a profile or
keystore, call Conviction or Particle services, or move funds.
