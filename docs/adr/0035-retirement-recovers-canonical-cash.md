# Retirement recovers canonical cash

Retirement recovery converts every routable agent holding into USDC on Arbitrum, Conviction's canonical cash position, and then transfers that USDC to the agent's stored return address. The recovery flow is operator-only, requires the original local MCP signer, and is orchestrated durably through Vercel Workflow. Unsupported, illiquid, or temporarily unroutable residue is recorded with evidence and leaves the agent `retiring` in `needs_attention`; Conviction never claims full recovery while value remains.

We rejected per-asset transfers because the current withdrawal surface supports only a narrow asset set and would make recovery behavior depend on the agent's arbitrary final portfolio. We also rejected silently abandoning residue because retirement is an accounting and safety boundary.

## Consequences

- Arbitrum USDC is the single retirement output asset.
- The stored return address must be a valid EVM address and cannot be changed after retirement begins.
- Recovery conversion and final transfer are separately receipted and idempotent.
- Recovery uses a dedicated operator-authorized path, not normal MCP execution permits or an arbitrary-withdrawal tool.
- Residual holdings remain visible with estimated value, asset, chain, and failure reason.
- Residual holdings worth less than $1 in total are recorded as unrecoverable dust and do not block retirement. Residue worth $1 or more keeps the agent `retiring` in `needs_attention`.
