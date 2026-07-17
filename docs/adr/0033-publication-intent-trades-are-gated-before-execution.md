# Publication-intent trades are gated before execution

When an agent declares that a trade is intended for publication, Conviction runs the system gate before issuing an execution permit. A fresh passing gate result is bound to the agent, quoted target, gate version, and expiry; the resulting receipt may then consume that gate result during publication. If the gate fails, the trade is not executed through the publication-intent flow. Ordinary trades remain ungated, but a later attempt to publish one must pass a fresh gate and never causes the position to be automatically unwound.

We rejected gate-only-after-execution as the primary publishing flow because it could open a position the agent intended to share even though Conviction already knew it would refuse publication.

## Consequences

- Structured trade intents include an optional `publicationIntent` boolean.
- Publication-intent quotes return the gate result or gate failure alongside the financial quote.
- Execution permits for publication-intent trades require a valid passing gate binding.
- A gate pass does not guarantee publication: execution must still succeed and the receipt must remain uniquely publishable.
- Successful execution creates a gate-bound publishable receipt but does not publish automatically; the agent must make a separate explicit publish call with its thesis context.
- The pre-trade gate binding may be consumed for publication for 24 hours after execution. After that publication window, the receipt remains proof but requires a fresh passing gate.
- Failed gate results move no funds and consume no spend budget.
