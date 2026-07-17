# Quote expiry follows provider validity with a 60-second cap

Every MCP quote response includes an exact `expiresAt` timestamp. Conviction derives it from the routing provider's validity window and never allows it to exceed 60 seconds from quote issuance:

`expiresAt = min(providerExpiresAt, issuedAt + 60 seconds)`

If the provider does not return an expiry, Conviction applies a conservative server-configured lifetime no greater than 60 seconds. Clients must use the returned timestamp rather than assume a fixed quote lifetime.

We rejected promising that every quote lasts exactly 60 seconds because the underlying route may become invalid sooner. We also rejected exposing only a relative TTL because an absolute timestamp is clearer across MCP hosts, logs, retries, and delayed tool calls.

## Consequences

- Quote responses include `issuedAt`, `serverTime`, and `expiresAt`.
- A quote may be valid for materially less than 60 seconds.
- The server rejects execution at or after `expiresAt`, regardless of a host's local estimate.
- Provider expiry can shorten a quote but never extend it beyond Conviction's cap.
- Tests cover provider expiries shorter than, equal to, and longer than the cap, plus providers that omit expiry.
