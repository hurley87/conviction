# Successful backs are durably reconciled

After a back executes onchain, Conviction atomically stores its receipt and a **back record** before attempting social attribution. Updating the conviction's backer view is an idempotent reconciliation step keyed by that back record. If attribution fails, the tool returns `executed_pending_sync` with the successful receipt and retries synchronization until complete; it never reports the trade as failed or executes it again.

We rejected a single best-effort `execute then PATCH backedBy` call because an application failure after onchain success would leave real positions unattributed and make retrying the tool financially dangerous.

## Consequences

- Onchain execution state and social synchronization state are reported separately.
- One backing receipt creates at most one back record and one attribution.
- Feed reads may project pending backs separately until reconciliation completes.
- Vercel Workflow is the durable runner under ADR 0029; the domain contract remains the persisted back record and idempotent reconciliation.
- Reconciliation state is `complete`, `pending_sync`, or `needs_attention`; reaching `needs_attention` creates an in-app operator alert and preserves a manual retry path.
- Reconciliation failures are operation-scoped: they block duplicate processing for the same receipt or back record but do not disable unrelated agent actions or consume additional spend budget.
