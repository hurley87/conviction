# Agent permission (Path B) is fund-isolation + capability-scoping, not cryptographic scoping

Under Path B the agent operates an **agent UA** with a **local MCP signer**. The signer could, at the chain level, send funds anywhere, so the "no external withdrawal" promise is **not** cryptographic. We enforce it instead by:

- **Capability-scoping at the verb surface.** The MCP server exposes only `getUniversalBalance / quoteTrade / executeTrade / postConviction / copyConviction`. There is deliberately **no verb that sends to an arbitrary address**, so the agent has no tool to withdraw.
- **Fund isolation.** The agent can only ever lose what the user funded into its UA. The "cap" is the funded amount, optionally backed by a total-spend ceiling checked in the verb layer.
- **Local MCP signer.** The setup CLI generates and encrypts the signer on the operator's machine. Conviction's backend and the agent/LLM never receive the private key; the model only calls verbs.
- **Backend agent policy.** Every value-moving MCP action requires a live execution permit under the backend's current status and spend limits (ADR 0020). Local policy may be stricter but cannot override disablement or increase caps.
- **Disable or retire.** Disablement stops Conviction-issued authority immediately; retirement permanently closes the agent and recovers supported funds to its configured return address (ADR 0021).

This keeps every permission test honest: over-cap fails, no external withdrawal tool exists, disablement halts MCP action, and retirement removes the funded exposure.

We did **not** wait for Path A (a cryptographically scoped session key on the user's own UA), because a 7702 EOA holds only one delegation at a time, so third-party session keys can't be stacked on the user's UA, and Particle's session-key support in 7702 mode is unconfirmed. Path A remains noted upside; if Particle confirms it, it upgrades the guarantee from capability-scoped to cryptographic.

## Consequences
- The pitch must describe the guarantee honestly as fund-isolation + capability-scoping, not "the agent cryptographically cannot withdraw."
- Conviction never custodies Path B agent keys. A broadly privileged local MCP host may still be able to reach the keystore, so operators must use a dedicated low-balance agent UA and narrow host permissions.
