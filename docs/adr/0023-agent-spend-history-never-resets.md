# Agent spend history never resets

Each agent records immutable **lifetime spend** and an operator-controlled **spend budget**. Remaining budget is derived as `spend budget - lifetime spend`; successful trade and back debits increase lifetime spend, while quotes, failed executions, and publishing do not. A permit reserves the quote's `dollarsIn`, and settlement records the executed `dollarsIn` from Particle's total USD decrease as the **counted debit**. `feeUsd` remains an explanatory breakdown and is not added again, so fees are counted exactly once. Operators may increase or lower the spend budget with explicit authenticated confirmation, but they cannot reset or reduce lifetime spend. We rejected resettable cumulative usage because it obscures how much an agent has actually spent and weakens auditability.

## Consequences

- Raising the spend budget grants additional future authority and creates an audit event.
- Lowering the budget takes effect immediately; if it is at or below lifetime spend, the agent becomes capped.
- Capped is a private policy state presented publicly as Paused. Increasing the budget automatically returns the agent to Active unless it is independently disabled.
- UI and tool outputs show lifetime spend, spend budget, and remaining budget separately.
- If executed counted debit differs from the reservation, reconciliation commits the executed amount and releases or charges the difference atomically.
- Any period-based budgets are future policy types, not resets of lifetime history.
