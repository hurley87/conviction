# `tools/list` always exposes the complete v1 contract

Every provisioned MCP server exposes the complete v1 tool set through `tools/list`, regardless of the agent's current action policy, balance, spend budget, or lifecycle status. Tool availability represents protocol compatibility; runtime policy determines whether a particular invocation is authorized.

When trade, back, or publish is disabled by the operator, the corresponding write tool returns the stable error code `action_disabled`. The response identifies the disabled action and explains that only the operator can enable it in Agent Settings or through the operator CLI. It must not suggest that the model call another MCP tool to alter policy.

Quotes and eligible reads retain their existing behavior. Lifecycle states may block all writes with their own more specific stable status errors, but they do not remove tools from discovery.

We rejected policy-dependent tool discovery because hosts cache tool lists differently, and a missing tool can be mistaken for an outdated package, unsupported client, or installation problem. A stable contract also makes client compatibility tests and generated documentation deterministic.

## Consequences

- `tools/list` is identical across active, unfunded, disabled, capped, retiring, and retired profiles within the same package major.
- Tool descriptions disclose relevant policy requirements without claiming that discovery means authorization.
- `conviction_account_status` returns current action policy and lifecycle state so a host can reason before invoking a write.
- `action_disabled` responses contain no settings mutation link or credential that the model could use directly.
- Policy changes take effect immediately without requiring MCP reconnection or tool-list refresh.
- Tests snapshot one canonical v1 tool list and exercise runtime denials separately.
