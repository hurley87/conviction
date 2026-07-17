# Vercel Workflow runs post-transaction reconciliation

Conviction uses **Vercel Workflow** as the canonical durable runner for post-transaction processes that must survive request termination, retries, crashes, and deployments. Initial workflows cover back-attribution reconciliation, receipt/activity synchronization, and the canonical-cash retirement recovery defined in ADR 0035. Neon remains the system of record: the synchronous transaction path first commits the onchain result and durable workflow input, then starts or resumes an idempotent workflow from that persisted state.

We rejected request-scoped background work because it can disappear after the response, and rejected building a custom queue/retry state machine because Vercel Workflow already provides persisted steps, automatic retries, versioned runs, and operational visibility for this Vercel-hosted Next.js app. Vercel Queues remains a future option for high-volume event fan-out, not the primary abstraction for these stateful multi-step processes.

## Consequences

- Workflow steps never issue execution permits, reserve spend, sign transactions, or define authoritative onchain state.
- Every workflow step is idempotent and keyed by a durable domain record such as a back record, receipt, or retirement ID.
- Workflow failure cannot cause a successful onchain action to execute again.
- Workflow run IDs are stored on domain records for observability and support.
- Retryable failures remain `pending_sync`; exhausted or non-retryable failures become `needs_attention`, create an in-app operator alert, and remain manually retryable.
- The implementation adds the Workflow SDK and Vercel deployment configuration, plus a deterministic local/test world for CI.
