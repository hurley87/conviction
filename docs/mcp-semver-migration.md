# MCP semver and migration

Package: `@getconviction/mcp` (ADR 0042 / 0046).

- **Major** (`@getconviction/mcp@N`): breaking tool contract, schemas, or safety boundaries. Host configs must retarget the new major pin.
- **Minor / patch**: bugfixes and additive non-breaking improvements within the same major. Generated snippets keep the current major pin (now `@getconviction/mcp@2`).

See [packages/mcp/CHANGELOG.md](../packages/mcp/CHANGELOG.md) for the tool-contract changelog.
