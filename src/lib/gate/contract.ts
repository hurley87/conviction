// Contract verification + holder concentration via Blockscout explorer API
// (free, no API key — morning desk workflow).

import type { GateCheck } from "@/lib/verbs/types";
import type { GateChainInfo } from "@/lib/gate/chains";

/** Fail when the top N holders own more than this fraction of supply. */
export const DEFAULT_MAX_TOP_HOLDER_FRACTION = 0.5;
export const DEFAULT_TOP_HOLDER_COUNT = 10;

export type ContractDeps = {
  fetch: typeof fetch;
  maxTopHolderFraction?: number;
  topHolderCount?: number;
};

type SmartContractResponse = {
  is_verified?: boolean;
};

type TokenResponse = {
  total_supply?: string | null;
};

type HolderItem = {
  value?: string;
};

type HoldersResponse = {
  items?: HolderItem[];
};

/**
 * Passes only when the contract is verified and top holders are not too
 * concentrated. Failure names the specific reason in plain language.
 */
export async function checkContractAndHolders(
  address: string,
  chain: GateChainInfo,
  deps: ContractDeps,
): Promise<GateCheck> {
  const evidenceUrl = `${chain.explorerTokenUrl(address)}#code`;
  const maxFraction =
    deps.maxTopHolderFraction ?? DEFAULT_MAX_TOP_HOLDER_FRACTION;
  const topN = deps.topHolderCount ?? DEFAULT_TOP_HOLDER_COUNT;
  const origin = chain.blockscoutOrigin;

  let verified = false;
  try {
    const res = await deps.fetch(
      `${origin}/api/v2/smart-contracts/${address}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const body = (await res.json()) as SmartContractResponse;
      verified = Boolean(body.is_verified);
    }
  } catch {
    verified = false;
  }

  if (!verified) {
    return {
      name: "Contract source is not verified",
      passed: false,
      evidenceUrl,
    };
  }

  let concentrated = false;
  try {
    const [tokenRes, holdersRes] = await Promise.all([
      deps.fetch(`${origin}/api/v2/tokens/${address}`, {
        headers: { Accept: "application/json" },
      }),
      deps.fetch(
        `${origin}/api/v2/tokens/${address}/holders?limit=${topN}`,
        { headers: { Accept: "application/json" } },
      ),
    ]);

    if (!tokenRes.ok || !holdersRes.ok) {
      // Can't prove concentration is safe — fail closed.
      concentrated = true;
    } else {
      const token = (await tokenRes.json()) as TokenResponse;
      const holders = (await holdersRes.json()) as HoldersResponse;
      const supply = Number.parseFloat(token.total_supply ?? "0");
      if (!Number.isFinite(supply) || supply <= 0) {
        concentrated = true;
      } else {
        const topSum = (holders.items ?? [])
          .slice(0, topN)
          .reduce((sum, h) => {
            const value = Number.parseFloat(h.value ?? "0");
            return sum + (Number.isFinite(value) ? value : 0);
          }, 0);
        concentrated = topSum / supply > maxFraction;
      }
    }
  } catch {
    concentrated = true;
  }

  if (concentrated) {
    return {
      name: "Top holders own too much of the supply",
      passed: false,
      evidenceUrl: `${chain.explorerTokenUrl(address)}#balances`,
    };
  }

  return {
    name: "Contract verification and holder concentration",
    passed: true,
    evidenceUrl,
  };
}
