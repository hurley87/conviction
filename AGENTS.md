<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Standard commands live in the root `package.json` scripts (`dev`, `lint`, `test`, `build`, `mcp:mock`); CI runs them in `.github/workflows/ci.yml`. Dependencies are installed on startup by the update script (`npm ci`), which also builds `@getconviction/mcp` via its `prepare` script.

Non-obvious notes:
- **Runs fully in mock mode with zero credentials.** All env vars in `.env.example` (Privy, Particle, Neon `DATABASE_URL`, AI Gateway) are optional. `IS_LIVE` (`src/lib/env.ts`) is gated on `NEXT_PUBLIC_PRIVY_APP_ID`; without it auth uses a mock local user, `getSql()` returns `null`, and the concierge falls back to a deterministic regex parser. So `npm run dev` (web app on port 3000) works out of the box — no DB or secrets needed. Add `.env.local` only to exercise live auth/persistence/trading.
- **Two independent surfaces.** The Next.js web app and the `@getconviction/mcp` stdio server are launched separately; neither requires the other. `npm run mcp:mock` runs the MCP server in deterministic mock mode (stdio JSON-RPC, no web app, no credentials).
- **`npm test` rebuilds `@getconviction/mcp` first** (`tsc`) before running Vitest; run it from the repo root.
- Real-funds scripts under `scripts/` (e.g. `smoke-spine.ts`) hit live services and are intentionally excluded from CI — do not run them without credentials/funds.
