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
| Host missing tools | Ensure config pins `@getconviction/mcp@1` and uses the shared runner. |

Support reports: `conviction-mcp doctor --profile <name> --report ./doctor-report.json`.
Never paste keystore passwords, backups, or signed payloads into tickets.
