# Privacy and retention (MCP)

| Data | Retention | Notes |
| --- | --- | --- |
| Agent audit events | Permanent | Domain facts only; never host prompts (ADR 0036). |
| Operator notifications | Durable until read/cleared | Idempotent; never block tx results. |
| Local MCP logs | 30 days | `~/.conviction/logs`; redacted; stderr mirror. |
| Doctor support reports | Operator-controlled local files | Mode `0600`; never auto-uploaded (ADR 0044). |
| Keystore / backup | Local only | Passphrases never leave the machine. |

CLI telemetry is off by default.
