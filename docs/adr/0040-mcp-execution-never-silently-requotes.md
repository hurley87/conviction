# MCP execution never silently requotes

An MCP execution call may consume only the exact server-issued quote identified by its `quoteId`. If that quote has expired, execution returns `quote_expired`. If current execution cannot satisfy the quote's minimum-received floor, it returns `price_floor_breached`. The server never refreshes the quote, substitutes a route, changes the amount or floor, or proceeds under newly calculated terms inside an execution call.

After either failure, the host agent must explicitly call the corresponding quote tool and decide whether to execute the newly returned `quoteId`. We rejected automatic requoting because an execute call would otherwise move funds under terms the host had not inspected, and retry behavior could become ambiguous during volatile prices or route changes.

## Consequences

- Quote and execute remain separate, observable MCP actions.
- A replacement quote has a new `quoteId`, expiry, route, expected output, and intent fingerprint.
- The failed quote is never revived or mutated.
- Automatic retries of execution may return the prior idempotent result, but may not obtain or consume a different quote.
- Human-facing product flows may help a person request a new quote, but the MCP protocol still requires a distinct quote call before another execution attempt.
