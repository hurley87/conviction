// UA routability — listing requirement. Uses the real warm-up flow
// (warmUpToken → getTokenPair). All non-primaries on Arbitrum fail today.

import type { GateCheck } from "@/lib/verbs/types";
import {
  hasWarmUpRoute,
  type WarmUpAccount,
  type WarmUpOptions,
  type WarmUpToken,
} from "@/lib/ua/warm-up";
import type { GateChainInfo } from "@/lib/gate/chains";

export type RoutabilityDeps = {
  /** Injected seam for unit tests (ADR 0014). Live path uses Particle warm-up. */
  checkRouter: (token: WarmUpToken) => Promise<boolean>;
};

/** Build a checkRouter from a warm-up account (Particle SDK surface). */
export function routerCheckFromWarmUp(
  ua: WarmUpAccount,
  options: WarmUpOptions = {},
): RoutabilityDeps["checkRouter"] {
  return (token) => hasWarmUpRoute(ua, token, options);
}

export async function checkUaRoutability(
  address: string,
  chain: GateChainInfo,
  deps: RoutabilityDeps,
): Promise<GateCheck> {
  const token: WarmUpToken = {
    chainId: chain.chainId,
    address,
  };
  const evidenceUrl = chain.explorerTokenUrl(address);

  let routable = false;
  try {
    routable = await deps.checkRouter(token);
  } catch {
    routable = false;
  }

  if (!routable) {
    return {
      // Plain language for a gate-kill card (ARB on Arbitrum is the demo case).
      name: "No route through your Universal Account",
      passed: false,
      evidenceUrl,
    };
  }

  return {
    name: "UA routability",
    passed: true,
    evidenceUrl,
  };
}
