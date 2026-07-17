# Unfunded agents may connect and use non-execution tools

A provisioned, backup-verified agent may connect to an MCP host before its Universal Account has a spendable balance. It may inspect account status and deposit addresses, read the conviction network, retrieve existing receipts, and request quotes. Value-moving execution remains unavailable and returns the stable error code `insufficient_balance`.

We rejected requiring funding before connection because connection setup and funding are easier to diagnose as separate steps, and an operator should be able to verify the installation before sending funds. We also rejected treating an unfunded account as disabled because lack of balance is an execution precondition, not a policy or lifecycle decision.

## Consequences

- The CLI and Agent Access page can verify host connectivity before funding.
- `conviction_account_status` explicitly reports whether the account has a spendable balance.
- Quotes are estimates and do not imply that execution is currently possible.
- Funding does not require reprovisioning, reconnecting, or changing the signer.
- An execution request with insufficient spendable balance fails before signing or obtaining a spend reservation.
