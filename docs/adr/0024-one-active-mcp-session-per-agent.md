# One active MCP session per agent

An agent profile may have exactly one active **MCP lease**. The local server acquires and renews the lease while running; another process or machine is rejected until the lease expires or the operator explicitly replaces it. We rejected concurrent sessions even though execution permits already serialize spend, because two independent agents sharing one budget, signer identity, and public handle would create confusing behavior, duplicated publication, and unclear operational ownership.

## Consequences

- The backend stores a lease ID, expiry, and last heartbeat for each active agent.
- Process crashes recover automatically after a short lease timeout.
- Explicit replacement invalidates the old lease immediately and creates an audit event.
- Read and write MCP tools require a valid lease; the operator's web settings and lifecycle controls do not.
