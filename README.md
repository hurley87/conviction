# Conviction

Chain-abstracted social trading. Users hold a single [Universal Account](https://getconviction.xyz), trade from one unified balance, and publish trades with reasoning — **convictions** — that others can back/copy regardless of which chain their funds sit on.

## Surfaces

Two independent surfaces; neither requires the other:

- **Next.js app** — consumer UI (deck, feed, concierge, Agent Access)
- **`@getconviction/mcp`** — local stdio MCP server for agent hosts

## Prerequisites

- Node.js ≥ 20
- npm (this repo uses npm workspaces)

## Quick start

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app runs fully in **mock mode with zero credentials**. Live auth, persistence, and trading are gated on `NEXT_PUBLIC_PRIVY_APP_ID` (`IS_LIVE` in `src/lib/env.ts`). Without it, auth uses a mock local user, the database client returns `null`, and the concierge falls back to a deterministic regex parser.

## Optional live mode

Copy [`.env.example`](.env.example) to `.env.local` and fill in what you need:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy auth (enables live mode) |
| `PRIVY_APP_SECRET` / `PRIVY_JWT_VERIFICATION_KEY` | Server-side Privy verification |
| `NEXT_PUBLIC_PARTICLE_*` | Particle Universal Accounts |
| `DATABASE_URL` | Neon Postgres (feed / identity) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway (concierge LLM) |

See `.env.example` for comments and optional MCP/smoke overrides.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | ESLint |
| `npm test` | Build `@getconviction/mcp`, then run Vitest |
| `npm run test:watch` | Vitest watch mode |
| `npm run mcp:mock` | MCP server in deterministic mock mode (stdio) |
| `npm run mcp:init` | Redeem Agent Access handoff into a local profile |
| `npm run mcp:doctor` | Non-value-moving connection checks for a profile |

## MCP

```bash
npm run mcp:mock
```

For live provisioning (`init` → `doctor` → fund → `serve`), see [`packages/mcp/README.md`](packages/mcp/README.md) and [`docs/mcp-install.md`](docs/mcp-install.md).

## Docs

- [`CONTEXT.md`](CONTEXT.md) — product language and glossary
- [`docs/`](docs/) — PRD, build guide, ADRs, MCP docs
- [`AGENTS.md`](AGENTS.md) — agent / local-dev notes
- [`packages/mcp/README.md`](packages/mcp/README.md) — MCP package

## Deploy

The Next.js app deploys on [Vercel](https://vercel.com). Set the env vars from `.env.example` on the project before enabling live mode in production.
