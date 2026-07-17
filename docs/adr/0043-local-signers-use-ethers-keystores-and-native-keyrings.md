# Local signers use ethers keystores and native keyrings

Each local MCP signer is stored as an ethers v6 encrypted JSON keystore using scrypt. The keystore file is created with owner-only `0600` permissions.

For interactive macOS and Linux installations, `init` generates a high-entropy keystore unlock secret and stores that secret in the operating system credential store through `@napi-rs/keyring`: macOS Keychain or Linux Secret Service. The encrypted keystore remains a file; the credential store contains only its unlock secret.

Headless Linux and WSL installations without an available credential store may supply `CONVICTION_KEYSTORE_PASSWORD`. This variable contains only the encrypted keystore's password, never a raw private key. The CLI must reject startup if neither an approved credential-store entry nor the headless password is available.

Signer backups are separately re-encrypted with an operator-chosen recovery passphrase rather than copied with the machine unlock secret. Provisioning remains incomplete until the CLI successfully decrypt-verifies that backup and confirms it resolves to the same public address.

We rejected `keytar` because its upstream repository is archived. We also rejected storing the private key itself in the operating-system credential store because a portable, versioned encrypted keystore gives the signer an inspectable backup and migration format while the keyring protects unattended local unlock.

## Consequences

- The keystore format and encryption parameters are versioned so future migrations can preserve compatibility.
- `doctor` verifies file ownership and mode, keystore parsing, public-address consistency, and keyring availability without printing secrets.
- Backup recovery requires the operator's recovery passphrase and does not depend on the original machine's Keychain or Secret Service.
- A recovered backup is imported into a new local keystore protected by a newly generated machine unlock secret.
- The implementation uses `@napi-rs/keyring` directly and does not silently fall back to command-line keychain helpers or plaintext/file-based credential stores.
- Exact scrypt work parameters are frozen during the implementation security review and covered by migration tests.
