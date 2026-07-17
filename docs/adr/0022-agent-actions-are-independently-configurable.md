# Agent actions are independently configurable

The agent operator can independently enable or disable three write capabilities in Agent Settings: **trade**, **back**, and **publish**. These controls are part of the backend-authoritative agent policy and cannot be changed through MCP tools. We rejected one all-or-nothing "agent enabled" permission because operators may reasonably want a research-and-publish agent that cannot trade, a backing-only agent, or a trading agent that cannot publish publicly.

## Consequences

- Execution permits are issued only for actions currently enabled by the action policy.
- Trade and back quotes remain available when execution is disabled because quotes move no funds and reserve no spend.
- Disabling an action invalidates outstanding permits for that action immediately.
- A publication-intent trade still requires a later explicit publish call, so disabling publish after execution prevents publication without changing the completed position.
- Lifecycle disablement still blocks every write regardless of the individual action settings.
- Product settings and audit events must show policy changes at the individual-action level.
- Disabled write tools remain visible through `tools/list` and return `action_disabled` when invoked under ADR 0047.
