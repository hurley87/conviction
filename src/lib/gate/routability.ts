// UA routability — listing requirement. Uses the real warm-up flow
// (warmUpToken → getTokenPair). All non-primaries on Arbitrum fail today.

import type { GateCheck } from "@/lib/verbs/types";
import type { WarmUpRouteResult, WarmUpToken } from "@/lib/ua/warm-up";
import type { GateChainInfo } from "@/lib/gate/chains";

export const ROUTABILITY_CHECK_NAME = "UA routability";
export const NO_ROUTE_DETAIL = "No route through your Universal Account";
export const ROUTE_CHECK_ERROR_DETAIL =
  "Couldn't check Universal Account routing";

export type RoutabilityDeps = {
  /**
   * Injected seam for unit tests (ADR 0014). Live path uses
   * `checkWarmUpRoute` from `@/lib/ua/warm-up`.
   */
  checkRouter: (token: WarmUpToken) => Promise<WarmUpRouteResult>;
};

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
  const result = await deps.checkRouter(token);

  switch (result.status) {
    case "routable":
      return {
        id: "routability",
        name: ROUTABILITY_CHECK_NAME,
        passed: true,
        evidenceUrl,
      };
    case "no_route":
      return {
        id: "routability",
        name: ROUTABILITY_CHECK_NAME,
        passed: false,
        detail: NO_ROUTE_DETAIL,
        evidenceUrl,
      };
    case "error":
      return {
        id: "routability",
        name: ROUTABILITY_CHECK_NAME,
        passed: false,
        detail: ROUTE_CHECK_ERROR_DETAIL,
        evidenceUrl,
      };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
