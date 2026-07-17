# The MCP server is local stdio, one instance per agent UA

The MCP server runs **locally** and is spawned by the MCP host over stdio, configured per-machine. The setup CLI generates one **local MCP signer**, stores it in an encrypted local keystore, and binds its public address to one **agent UA**. **One running instance operates exactly one agent UA, and one agent profile permits only one active MCP lease** (ADR 0024). MCP host configuration references a local profile; it never contains the raw private key. The funded balance bounds exposure; operators can disable the profile temporarily or retire it permanently under ADR 0021.

We rejected a **hosted multi-tenant endpoint** (one cloud server serving many users via API-key/OAuth auth, a key→account database custodying everyone's keys, and tenant isolation): it is substantial backend and ops work that demonstrates nothing the bounty rewards. Local stdio is the canonical Claude Desktop setup, needs no hosted auth or secret custody, and makes the account binding trivial. Hosting is the post-hackathon productionization step.

## Consequences
- The MCP tools wrap the **same verb-layer module** the web app imports — no second implementation.
- Per-agent isolation is physical (separate process + separate local MCP signer), not logical.
- Conviction's backend stores the agent's public identity and policy state, never its private key.
