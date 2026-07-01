// Single source of truth for the live-vs-mock decision: the app runs the live
// Privy/Particle stack only when a Privy app id is configured; otherwise it
// falls back to the zero-credential mock (ADR 0014). The NEXT_PUBLIC_ flag is
// inlined at build time, so the choice is fixed per build.

/** The Privy app id, or undefined for local/mock dev. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/** True when the live auth stack is configured. */
export const IS_LIVE = Boolean(PRIVY_APP_ID);

/**
 * True when the Vercel AI Gateway is configured for LLM intent parsing. When
 * false, parsing falls back to the deterministic heuristic (keeps CI offline,
 * ADR 0014). Server-only var — never inlined into the client bundle.
 */
export const IS_LLM_PARSING = Boolean(process.env.AI_GATEWAY_API_KEY);
