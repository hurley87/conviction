# Workflow operations (MCP reconciliation)

Vercel Workflow runs post-transaction reconciliation only (ADR 0028 / 0029).
Workflows never sign and never repeat onchain execution.

| Domain | Workflow | Operator retry |
| --- | --- | --- |
| Back attribution | `src/workflows/back-attribution.ts` | `POST /api/agents/back/retry` |
| Retirement residuals | `src/workflows/retirement-recovery.ts` | `POST /api/agents/retirement/retry` (+ CLI recover for value-moving legs) |

States: `complete` | `pending_sync` | `needs_attention` (orthogonal to onchain success).

MCP tool calls emit `x-conviction-correlation-id`. Durable records store
`workflowRunId` for correlation in the Vercel dashboard and Agent Access
notifications.
