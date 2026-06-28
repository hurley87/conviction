# Agent permission (Path B) is fund-isolation + capability-scoping, not cryptographic scoping

Under Path B the agent operates **its own** Universal Account, so it holds that UA's signer and could, at the chain level, send funds anywhere. The "no external withdrawal" promise is therefore **not** cryptographic. We enforce it instead by:

- **Capability-scoping at the verb surface.** The MCP server exposes only `getUniversalBalance / quoteTrade / executeTrade / postConviction / copyConviction`. There is deliberately **no verb that sends to an arbitrary address**, so the agent has no tool to withdraw.
- **Fund isolation.** The agent can only ever lose what the user funded into its UA. The "cap" is the funded amount, optionally backed by a total-spend ceiling checked in the verb layer.
- **Server-held key.** The agent's UA signer is generated and held server-side per agent; the agent/LLM never sees a private key, it only calls verbs.
- **Revoke = sweep + disable.** Revocation sweeps the remaining balance back to the user's UA and disables the agent.

This keeps every permission test honest: over-cap fails (insufficient funds + verb-layer ceiling), no external withdrawal (no such verb), revoke halts action.

We did **not** wait for Path A (a cryptographically scoped session key on the user's own UA), because a 7702 EOA holds only one delegation at a time, so third-party session keys can't be stacked on the user's UA, and Particle's session-key support in 7702 mode is unconfirmed. Path A remains noted upside; if Particle confirms it, it upgrades the guarantee from capability-scoped to cryptographic.

## Consequences
- The pitch must describe the guarantee honestly as fund-isolation + capability-scoping, not "the agent cryptographically cannot withdraw."
