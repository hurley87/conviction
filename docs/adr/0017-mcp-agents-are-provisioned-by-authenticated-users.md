# MCP agents are provisioned by authenticated Conviction users

Only an authenticated Conviction user can provision an agent UA. The Agent Access page issues a short-lived, single-use provisioning code; the local CLI generates a new local MCP signer and proves possession of its public address when redeeming that code, which binds the agent to its operator, handle, caps, and return address. V1 does not support anonymous provisioning, importing an existing private key, or creating an unowned agent directly from the CLI, because those paths weaken identity, recovery, and abuse controls.

## Consequences

- Conviction's backend records which authenticated user operates each agent but never receives the agent's private key.
- Provisioning codes cannot authorize trades and expire if they are not redeemed promptly.
- An operator must use the web app to create an agent before connecting an MCP host, and provisioning remains incomplete until the CLI verifies an encrypted signer backup.
- The MCP package remains publicly installable; authenticated provisioning gates real account access rather than package distribution.
- Real agent provisioning is open to every authenticated Conviction user at launch; it does not require an invitation or manual approval.
