# MCP cannot introduce arbitrary token addresses

MCP agents may trade Conviction's named product assets directly and may back the exact long-tail token target already attached to a published, gate-checked conviction. They cannot submit a new token contract address or construct an arbitrary `TokenRef` in v1. We rejected unrestricted address trading because it would bypass Conviction's gate process and turn a bounded social-trading interface into a general contract-address execution tool.

## Consequences

- Direct trade schemas expose named product-asset enums only.
- Back quotes derive any concrete token address and chain from the canonical conviction record, never MCP input.
- A conviction whose token reference is missing, changed, unsupported, or no longer routable cannot be backed until revalidated.
- Supporting agent-originated long-tail token discovery requires a future gated-candidate workflow, not a schema expansion.
