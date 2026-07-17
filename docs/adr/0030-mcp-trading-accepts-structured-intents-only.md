# MCP trading accepts structured intents only

MCP quote tools accept Conviction's structured trade-intent fields rather than free-form natural language. The host agent is responsible for translating the user's request into asset, amount or fraction, optional source asset, and destination fields; Conviction then validates those fields deterministically and returns precise correction requirements. We rejected running the in-app LLM intent parser behind MCP because it would make one model reinterpret another model's output, increase ambiguity and latency, and introduce an unnecessary model dependency into a value-moving interface.

## Consequences

- MCP schemas use enums, numeric bounds, and mutual-exclusion rules. Concrete long-tail token references come only from canonical published convictions under ADR 0031, never direct MCP input.
- Invalid or incomplete fields return stable validation codes and field-level guidance, not a guessed intent.
- The consumer concierge may continue accepting natural language because it owns the human clarification and confirmation experience.
- MCP examples may show natural-language prompts to hosts, but the server contract remains structured.
