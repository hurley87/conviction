# Workflow operations (MCP reconciliation)

Vercel Workflow runs read-only transaction-finality reconciliation and
post-finality application reconciliation (ADR 0028 / 0029). Workflows never
sign, call `sendTransaction()`, or repeat onchain execution.

| Domain | Workflow | Operator retry |
| --- | --- | --- |
| Execution finality | `src/workflows/execution-finality.ts` | `POST /api/agents/finality/retry` |
| Back attribution | `src/workflows/back-attribution.ts` | `POST /api/agents/back/retry` |
| Retirement residuals | `src/workflows/retirement-recovery.ts` | `POST /api/agents/retirement/retry` (+ CLI recover for value-moving legs) |

Execution outcomes are exactly `submitted`, `pending`, `finalized`, `partial`,
`failed`, and `needs_attention`. `complete`, `pending_sync`, and
`needs_attention` are separate application-sync states used only after a
confirmed finalized action (for example back attribution).

MCP tool calls emit `x-conviction-correlation-id`. Durable records store
`workflowRunId` for correlation in the Vercel dashboard and Agent Access
notifications.

## Execution-finality runbook

1. Submission first creates a durable execution and keeps its spend reservation
   held. Particle acceptance means `submitted`, not success.
2. The workflow calls Particle `getTransaction()` read-only. Provider responses
   are normalized into per-chain source, bridge, and destination leg states.
3. `pending` keeps the same execution, permit, and reservation. An authenticated
   retry with the same idempotency key may advance reconciliation but cannot
   sign or submit.
4. `finalized` requires every required leg to be terminal-successful with a
   confirmed transaction hash. Only then may accounting commit, a receipt be
   persisted, a trade become publishable, or a back begin attribution.
5. `failed` releases the reservation only when no successful value-moving leg
   was confirmed. `partial` and unresolved `needs_attention` keep the
   reservation held to prevent double counting or unsafe reuse.
6. Exhausted or non-retryable reconciliation becomes `needs_attention` with
   transaction, affected-leg, last-provider-status, workflow, and safe recovery
   evidence in Agent Access.

Operator retry is reconciliation-only. Inspect confirmed and unresolved legs,
verify provider status, and follow the recorded recovery guidance. Never create
a new idempotency key, re-sign, or resubmit the stored execution. If value is
stranded after a partial execution, manual recovery is an operator
responsibility and must follow a separately reviewed, destination-bound path.

## Migration and production verification

- Deploy the execution-finality schema and workflow before enabling the new
  server contract. Existing issued permits may expire and release normally.
  Existing `pending` permits/executions must be backfilled or attached to one
  durable execution record and queued for read-only reconciliation; do not
  replay their signing or submission step.
- Before production rollout, capture representative Particle
  `getTransaction()` responses for pending, success, partial/failure, missing
  legs, and unknown statuses. Verify the normalizer against those response
  shapes with redacted fixtures. Unknown or changed shapes must remain
  `pending` and eventually escalate to `needs_attention`, never finalize by
  inference.
