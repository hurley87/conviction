# Write errors follow a deterministic precedence

Every MCP write evaluates failures in this order:

1. Invalid input.
2. Authentication or MCP lease failure.
3. Existing idempotent result.
4. Lifecycle restriction.
5. `action_disabled`.
6. Quote validity or mismatch.
7. Spend limit or balance.
8. Provider or execution failure.

The server returns the first applicable result and does not continue into lower-priority checks. An authenticated retry with the same idempotency key returns its stored completed or durable in-progress result before evaluating current lifecycle, action policy, quote expiry, spend, or balance. It never submits another transaction. Authentication and lease checks remain earlier so an unauthenticated or displaced process cannot use idempotency keys to read action results.

We rejected whichever-error-happens-first behavior because distributed retries, concurrent policy changes, and provider latency would make agents receive inconsistent remediation. We also rejected re-evaluating current policy before returning a completed idempotent result because disabling an agent after execution must not make the original successful outcome disappear or tempt a host to retry under a new key.

## Consequences

- Every write accepts or derives a durable idempotency key before execution.
- Invalid schemas and field combinations fail without authentication-dependent side effects.
- Lifecycle errors take precedence over per-action policy errors.
- Quote errors take precedence over balance and spend errors once lifecycle and action policy allow the write.
- Provider calls occur only after all earlier checks pass and any required spend reservation succeeds.
- Stable errors include one primary code; additional applicable conditions may appear only as non-authoritative diagnostic metadata.
- Contract tests cover combinations of simultaneous failures and prove the same primary result across retries and restarts.
