# The MCP server is local stdio, one instance per agent UA

The MCP server runs **locally** and is spawned by the MCP host (e.g. Claude Desktop) over stdio, configured per-machine. The agent's UA signer key is supplied via env/config, and **one running instance operates exactly one agent UA** — the key in the config *is* the account. The funded cap is that UA's balance; "revoke" = sweep its funds and stop the server.

We rejected a **hosted multi-tenant endpoint** (one cloud server serving many users via API-key/OAuth auth, a key→account database custodying everyone's keys, and tenant isolation): it is substantial backend and ops work that demonstrates nothing the bounty rewards. Local stdio is the canonical Claude Desktop setup, needs no hosted auth or secret custody, and makes the account binding trivial. Hosting is the post-hackathon productionization step.

## Consequences
- The MCP tools wrap the **same verb-layer module** the web app imports — no second implementation.
- Per-agent isolation is physical (separate process + separate key), not logical.
