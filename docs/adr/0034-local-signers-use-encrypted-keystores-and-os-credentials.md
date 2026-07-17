# Local signers use encrypted keystores and operating-system credentials

The exact keystore, keyring adapter, file-permission, and backup format is refined by ADR 0043.

The setup CLI stores each local MCP signer as an encrypted keystore file with restrictive permissions. On macOS it stores the keystore unlock secret in Keychain; on supported desktop Linux it uses Secret Service when available. Headless Linux and WSL may provide `CONVICTION_KEYSTORE_PASSWORD` to unlock the encrypted file. Conviction never accepts a raw private key through environment variables, command arguments, project files, or MCP host configuration.

Conviction cannot reconstruct, reset, replace, or recover a lost signer or unlock secret. The operator may disable the agent from the web app, but recovering or moving its funds still requires the original signer. Losing every encrypted keystore copy or its unlock secret can permanently strand funds in the agent UA.

We rejected raw-key environment configuration because it is commonly exposed through process inspection, shell history, debug output, and copied client configuration. We also rejected mandatory interactive password prompts because Hermes, OpenClaw, and other unattended hosts must be able to restart safely.

## Consequences

- Agent profiles contain keystore paths and non-secret metadata only.
- `init` verifies the selected credential-store path and refuses insecure keystore file permissions.
- `doctor` reports credential-store availability without printing secrets.
- `init` requires an encrypted backup export and successful decrypt-verification before the agent becomes ready for funding.
- Backup and migration export an encrypted keystore only and require explicit operator authentication.
- Setup and funding surfaces disclose that signer recovery is impossible for Conviction.
- Native Windows credential storage remains outside the v1 support contract; WSL uses the Linux/headless path.
