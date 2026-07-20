# Conviction MCP troubleshooting

| Symptom | Check |
| --- | --- |
| `lease_conflict` | Another `serve` holds the lease; wait or `--replace-lease`. |
| `lease_lost` | Restart `conviction-mcp serve --profile …`. |
| Doctor Particle fail | Set `NEXT_PUBLIC_PARTICLE_PROJECT_ID` / `CLIENT_KEY` / `APP_ID` for the API host. |
| Doctor tool discovery fail | Rebuild `@getconviction/mcp`; confirm `LIVE_TOOLS` length 10. |
| Keystore unlock fail | `CONVICTION_KEYSTORE_PASSWORD` or OS keyring entry for the signer. |
| `lifecycle_blocked` | Agent disabled/capped/retiring — use Agent Settings or CLI enable. |
| `executed_pending_sync` | Onchain ok; attribution retrying — check Agent Access notifications. |
| `submitted` / `pending` | Finality is unresolved. Keep the same idempotency key, inspect the execution ID with `conviction_get_receipt`, and never re-sign or resubmit. |
| `partial` / `failed` / `needs_attention` | This is not successful or publishable. Review confirmed and affected legs in Agent Access and follow operator recovery guidance. |
| Host missing tools | Ensure config pins `@getconviction/mcp@2` and uses the shared runner. |

Support reports: `conviction-mcp doctor --profile <name> --report ./doctor-report.json`.
Never paste keystore passwords, backups, or signed payloads into tickets.
