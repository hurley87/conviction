// UniversalX-style route warm-up for tokens outside the primary set.
// Shared by the Particle UA client and gate-check (ADR 0017 / issue #23).

export type WarmUpToken = {
  chainId: number;
  address: string;
};

export type WarmUpAccount = {
  warmUpToken(
    token: WarmUpToken,
  ): Promise<{ router?: unknown | null } | null>;
  getTokenPair(
    token: WarmUpToken,
  ): Promise<{ pair?: { address: string; factory: string } } | null>;
};

export type WarmUpOptions = {
  polls?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export const NO_ROUTE_MESSAGE =
  "This token has no route through your Universal Account yet, so it can't be bought here.";

const DEFAULT_POLLS = 4;
const DEFAULT_POLL_MS = 3000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Register a route via warmUpToken, then poll getTokenPair until a DEX pair
 * appears. A null router means Particle can't route this token (true for all
 * non-primaries on Arbitrum as of 2026-07). */
export async function warmUpTokenPair(
  ua: WarmUpAccount,
  token: WarmUpToken,
  options: WarmUpOptions = {},
): Promise<{ address: string; factory: string }> {
  const polls = options.polls ?? DEFAULT_POLLS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const sleep = options.sleep ?? defaultSleep;

  const warm = await ua.warmUpToken(token);
  if (!warm?.router) {
    throw new Error(NO_ROUTE_MESSAGE);
  }
  for (let attempt = 0; attempt < polls; attempt++) {
    const pair = (await ua.getTokenPair(token))?.pair;
    if (pair?.address) {
      return { address: pair.address, factory: pair.factory };
    }
    await sleep(pollMs);
  }
  throw new Error(NO_ROUTE_MESSAGE);
}

/** True when warm-up yields a routable pair. Used by gate-check. */
export async function hasWarmUpRoute(
  ua: WarmUpAccount,
  token: WarmUpToken,
  options: WarmUpOptions = {},
): Promise<boolean> {
  try {
    await warmUpTokenPair(ua, token, options);
    return true;
  } catch {
    return false;
  }
}
