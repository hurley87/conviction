// Contract verification + holder concentration via Blockscout explorer API
// (free, no API key — morning desk workflow).
//
// Concentration is a *single EOA* check, not top-N sum. Real tokens (ARB,
// DEGEN, …) park most supply in contracts (bridges, Safes, vesting, LPs);
// summing those always false-fails. The rug signal is one wallet that can dump.

import type { GateCheck } from "@/lib/verbs/types";
import type { GateChainInfo } from "@/lib/gate/chains";

/** Fail when any single EOA among the top holders owns more than this share. */
export const DEFAULT_MAX_EOA_HOLDER_FRACTION = 0.2;
/** How many top holders to scan for EOAs (Blockscout default page size). */
export const DEFAULT_TOP_HOLDER_COUNT = 10;

/** @deprecated Prefer DEFAULT_MAX_EOA_HOLDER_FRACTION — kept for call-site aliases. */
export const DEFAULT_MAX_TOP_HOLDER_FRACTION = DEFAULT_MAX_EOA_HOLDER_FRACTION;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

export type ContractDeps = {
  fetch: typeof fetch;
  maxTopHolderFraction?: number;
  maxEoaHolderFraction?: number;
  topHolderCount?: number;
};

type SmartContractResponse = {
  is_verified?: boolean;
};

type TokenResponse = {
  total_supply?: string | null;
};

type HolderAddress = {
  hash?: string;
  is_contract?: boolean;
};

type HolderItem = {
  value?: string;
  address?: HolderAddress;
};

type HoldersResponse = {
  items?: HolderItem[];
};

/**
 * Passes only when the contract is verified and no single EOA among the top
 * holders owns too much supply. Failure names the specific reason in plain language.
 */
export async function checkContractAndHolders(
  address: string,
  chain: GateChainInfo,
  deps: ContractDeps,
): Promise<GateCheck> {
  const evidenceUrl = `${chain.explorerTokenUrl(address)}#code`;
  const maxFraction =
    deps.maxEoaHolderFraction ??
    deps.maxTopHolderFraction ??
    DEFAULT_MAX_EOA_HOLDER_FRACTION;
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
      // Blockscout rejects `?limit=` — use the default page and slice.
      deps.fetch(`${origin}/api/v2/tokens/${address}/holders`, {
        headers: { Accept: "application/json" },
      }),
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
        const maxEoaShare = maxEoaHolderShare(
          (holders.items ?? []).slice(0, topN),
          supply,
        );
        concentrated = maxEoaShare > maxFraction;
      }
    }
  } catch {
    concentrated = true;
  }

  if (concentrated) {
    return {
      name: "A single wallet owns too much of the supply",
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

/** Largest EOA share of supply among the given holder rows (contracts ignored). */
export function maxEoaHolderShare(
  holders: HolderItem[],
  supply: number,
): number {
  if (!(supply > 0)) return 1;

  let maxShare = 0;
  for (const h of holders) {
    const addr = h.address;
    if (!addr || addr.is_contract) continue;
    const hash = (addr.hash ?? "").toLowerCase();
    if (hash === ZERO_ADDRESS || hash === DEAD_ADDRESS) continue;

    const value = Number.parseFloat(h.value ?? "0");
    if (!Number.isFinite(value) || value <= 0) continue;
    maxShare = Math.max(maxShare, value / supply);
  }
  return maxShare;
}
