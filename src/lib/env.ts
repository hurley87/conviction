// Single source of truth for the live-vs-mock decision: the app runs the live
// Privy/Particle stack only when a Privy app id is configured; otherwise it
// falls back to the zero-credential mock (ADR 0014). The NEXT_PUBLIC_ flag is
// inlined at build time, so the choice is fixed per build.

/** The Privy app id, or undefined for local/mock dev. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/** True when the live auth stack is configured. */
export const IS_LIVE = Boolean(PRIVY_APP_ID);
