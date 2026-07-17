# Backend policy authorizes every agent execution

Conviction's backend is authoritative for an agent's status, action policy, per-trade limit, spend budget, and lifetime spend. Immediately before signing a value-moving action, the local MCP process must exchange the quote identity and fingerprint for a short-lived, single-use execution permit that reserves remaining budget under the current agent policy. Local configuration may fail earlier or impose stricter limits, but it cannot authorize an execution the backend rejects. If the backend is unavailable, value-moving tools fail closed while read-only wallet and network tools may continue.

We rejected local-only enforcement because website disablement, policy changes, concurrent MCP processes, and lifetime spend would otherwise create split-brain authority.

## Consequences

- A quote alone never authorizes signing; execution requires a live execution permit.
- Spend reservation, consumption, expiry, and reconciliation are backend state.
- A permit that is issued but never submitted must expire or be explicitly released.
- The local signer remains non-custodial even though Conviction controls whether its MCP product will invoke it.
