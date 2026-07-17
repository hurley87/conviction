# V1 allows one agent per user

One authenticated Conviction user may own one non-retired agent in v1. Retiring or disabled agents still occupy the slot; completing retirement releases it. The ownership data model remains one-to-many so a future release can raise the configurable limit without changing agent identity, signer, or policy boundaries. We rejected launching with multiple agents because separate strategies and identities are not yet proven user needs, while multi-agent provisioning adds UI, moderation, and support complexity immediately.

## Consequences

- Agent creation fails while the operator has any non-retired agent.
- The Agent Access page centers on one agent rather than an agent-management dashboard.
- Operators cannot replace a lost-signer agent by creating another until they permanently retire the old Conviction identity, even if its funds are stranded.
- Raising the limit later is a product-policy change, not a schema redesign.
