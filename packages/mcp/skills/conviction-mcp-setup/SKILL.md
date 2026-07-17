---
name: conviction-mcp-setup
description: Guide operators and agents through Conviction MCP v1 setup using the versioned setup contract. Use when installing @conviction/mcp, configuring Claude Code, Codex, Hermes, or OpenClaw, running doctor/status diagnostics, or deciding when human operator action is required. Does not provision, fund, change policy, or access secrets.
license: UNLICENSED
compatibility: Requires Node.js 20+, macOS or Linux, or Windows through WSL. Native Windows is deferred. Setup contract version 1.
metadata:
  setupContractVersion: "1"
  packageMajorPin: "@conviction/mcp@1"
---

# Conviction MCP setup (contract v1)

This skill explains the public setup journey for Conviction MCP. It is agent-readable and must stay aligned with setup contract version `1`.

## Shared MCP contract

Claude Code, Codex, Hermes, and OpenClaw share one MCP tool contract. Host-specific content is configuration only.

Generated package-runner configs always pin `@conviction/mcp@1`. Never suggest an unpinned `latest` major, and never embed signer secrets, unlock secrets, recovery passphrases, or one-time provisioning codes in host configuration.

## Platforms

| Platform | Support |
|---|---|
| macOS | Supported |
| Linux | Supported |
| Windows through WSL | Supported |
| Native Windows | Deferred |

On headless Linux or WSL, the operator may provide `CONVICTION_KEYSTORE_PASSWORD`. Raw private keys are never accepted.

## Setup steps

1. **Create agent** — Operator creates a pending agent in Agent Access.
2. **Provision locally** — Operator runs the one-time `conviction-mcp init --code …` handoff from Agent Access.
3. **Verify backup** — Init must export and decrypt-verify the encrypted backup before funding is unlocked.
4. **Configure host** — Operator adds a major-pinned stdio config for one of the four hosts.
5. **Verify connection** — Operator runs `conviction-mcp doctor --profile <name>` (non-value-moving).
6. **Fund account** — Only after doctor succeeds should the operator send funds to the deposit address.

## Host configuration patterns

Replace `<name>` with the local profile name. All hosts launch:

```text
npx -y @conviction/mcp@1 serve --profile <name>
```

### Claude Code

```sh
claude mcp add conviction -- npx -y @conviction/mcp@1 serve --profile <name>
```

### Codex

```sh
codex mcp add conviction -- npx -y @conviction/mcp@1 serve --profile <name>
```

Or `~/.codex/config.toml`:

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

## Diagnostics

- `conviction-mcp doctor --profile <name>` verifies profile integrity, keystore access, backend authentication, tool discovery, and account status without moving funds.
- `conviction-mcp doctor --profile <name> --report <path>` writes a redacted local support bundle. It never uploads.
- `conviction-mcp status --profile <name>` prints backend-authoritative identity and policy state.

Doctor success is the clear connection success state. Suggest funding only after that succeeds.

## When operator action is required

Ask the human operator to act when any of these are needed:

- Creating or retiring an agent in Agent Access
- Running or re-running `init` with a one-time code
- Choosing/storing a recovery passphrase or unlock secret
- Adding host configuration on their machine
- Running `doctor` / reviewing a support report
- Sending funds to the deposit address
- Changing policy, disablement, or retirement

## Hard boundaries for this skill

The skill may:

- Explain installation and major-pinned package-runner usage
- Explain host configuration for the four supported clients
- Explain doctor and status diagnostics
- Tell the operator when a human action is required in Agent Access or the local CLI

The skill must not:

- Provision or redeem an agent
- Fund an account or move value
- Change policy, disable, enable, or retire an agent
- Read, print, request, or store signer secrets, unlock secrets, recovery passphrases, or one-time codes
