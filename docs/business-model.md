# Business Model

How Conviction makes money, ranked by fit with the architecture and the cross-chain social-copy differentiator. (This is a strategy note, not an architectural decision — see `docs/adr/` for those.)

## 1. Primary engine — a take rate on volume

Every `executeTrade` and `copyConviction` already routes through UA's cross-chain convert, which is the natural toll booth. Take a small fee on trade size (~10–30 bps on direct trades). It is invisible because the fee is already folded into the "fee" line on the confirm card (ADR 0011), scales with usage, and adds no new surface area. This is how aggregators (1inch, Jupiter) and single-chain incumbents (fomo) monetize. Baseline, not differentiated.

## 2. Differentiated vector — copy fees split with the caller

When someone **backs a conviction**, take a higher fee (~50–100 bps of the copier's sized amount) and **split it with the original poster.** This:

- Creates a **creator flywheel** — good callers earn from being copied, so they post more and better convictions, which pulls in more copiers. The thing we monetize is the thing that grows the network.
- Makes the fee feel **earned** — you pay for someone's edge, not for plumbing.

`backedBy` already exists in the data model, so attribution is free. This is the lead vector: the cross-chain-from-any-chain copy is something single-chain incumbents structurally cannot do.

## 3. Incubation angle — charging agents for the rails

The strongest pitch is "Universal Accounts as the wallet layer for AI agents." Monetize it directly: agents trading through the MCP server pay per trade (same take rate) or **per-call via x402 micropayments** (a real near-term primitive). As agent volume grows, Conviction is the metered toll on agent cross-chain execution. This is the "adoption potential" story Particle's incubation track cares about.

---

**One-line pitch:** We take a small spread on cross-chain trade volume, and a copy fee we split with the caller — the same flywheel for humans and for AI agents, on rails no single-chain competitor can match.
