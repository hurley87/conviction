# MCP / agent API error codes

Stable machine-readable `code` values returned by Conviction MCP tools and
signed agent HTTP routes. Messages may change; codes are part of the v1 contract.

| Code | Meaning |
| --- | --- |
| `action_disabled` | Operator disabled this write action (trade/back/publish). |
| `agent_exists` | One non-retired agent already exists for the operator. |
| `agent_not_found` | Agent identity not found for this owner. |
| `arbitrary_token_rejected` | Caller supplied contract/TokenRef fields; named assets only. |
| `conviction_not_found` | Canonical conviction entry missing. |
| `executed_pending_sync` | Onchain succeeded; social attribution still reconciling. |
| `forbidden_field` | Input field is not allowed on this tool. |
| `gate_failed` | Publication-intent gate did not pass. |
| `handle_unavailable` | Requested agent handle is taken. |
| `handoff_expired` | Provisioning handoff code expired. |
| `handoff_used` | Provisioning handoff code already redeemed. |
| `insufficient_balance` | Unified balance cannot fund the quote size. |
| `intent_invalid` | Structured intent failed validation. |
| `invalid_auth` | Signature / auth headers rejected. |
| `invalid_cursor` | Pagination cursor is malformed or stale. |
| `invalid_input` | Request body failed schema/validation. |
| `invalid_pair` | Asset pair is not supported. |
| `invalid_proof` | Signer possession proof failed. |
| `invalid_request` | Malformed HTTP request. |
| `invalid_type` | Field type mismatch. |
| `invalid_value` | Field value out of range or illegal. |
| `lease_conflict` | Another MCP process holds the active lease. |
| `lease_lost` | Local lease is no longer valid; restart serve. |
| `lifecycle_blocked` | Agent disabled, capped, retiring, or retired. |
| `not_found` | Generic missing resource. |
| `price_floor_breached` | Execute would breach the quote floor. |
| `quote_expired` | Quote TTL elapsed. |
| `quote_mismatch` | Execute fingerprint does not match stored quote. |
| `quote_not_found` | Quote id unknown. |
| `receipt_not_found` | Receipt id unknown or not owned. |
| `receipt_not_publishable` | Receipt cannot be published (wrong kind/state). |
| `replay_rejected` | Signed request nonce/timestamp replay. |
| `required` | Required field missing. |
| `requires_balance` | Operation needs a funded account. |
| `resolved_zero` | Size resolved to zero. |
| `size_required` | Exactly one of `sizeUsd` / `fraction` required. |
| `spend_limit_exceeded` | Per-trade or budget cap would be exceeded. |
| `target_unroutable` | Back target from conviction failed routability. |
| `timestamp_skew` | Signed request clock skew too large. |
| `unauthenticated` | Missing or invalid operator/agent auth. |
| `unavailable` | Backend or dependency temporarily unavailable. |
| `unknown_field` | Unexpected input key. |
| `unsupported_asset` | Named product asset not supported. |
| `unsupported_chain` | Destination chain not supported. |
| `unsupported_on_chain` | Action not supported on the selected chain. |

See also [docs/mcp-server-prd.md](./mcp-server-prd.md) §9 and [packages/mcp/README.md](../packages/mcp/README.md).
