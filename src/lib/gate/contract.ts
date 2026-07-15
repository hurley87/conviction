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

export const CONTRACT_CHECK_NAME =
  "Contract verification and holder concentration";
export const UNVERIFIED_DETAIL = "Contract source is not verified";
export const CONCENTRATED_DETAIL =
  "A single wallet owns too much of the supply";
export const HOLDERS_UNREADABLE_DETAIL =
  "Couldn't verify holder concentration";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

export type ContractDeps = {
  fetch: typeof fetch;
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
 * holders owns too much supply. Failures keep a stable `name` and put the
 * reason in `detail`.
 */
export async function checkContractAndHolders(
  address: string,
  chain: GateChainInfo,
  deps: ContractDeps,
): Promise<GateCheck> {
  const codeEvidence = `${chain.explorerTokenUrl(address)}#code`;
  const balancesEvidence = `${chain.explorerTokenUrl(address)}#balances`;
  const maxFraction =
    deps.maxEoaHolderFraction ?? DEFAULT_MAX_EOA_HOLDER_FRACTION;
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
    return failContract(UNVERIFIED_DETAIL, codeEvidence);
  }

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
      return failContract(HOLDERS_UNREADABLE_DETAIL, balancesEvidence);
    }

    const token = (await tokenRes.json()) as TokenResponse;
    const holders = (await holdersRes.json()) as HoldersResponse;
    const supply = Number.parseFloat(token.total_supply ?? "0");
    if (!Number.isFinite(supply) || supply <= 0) {
      return failContract(HOLDERS_UNREADABLE_DETAIL, balancesEvidence);
    }

    const maxEoaShare = maxEoaHolderShare(
      (holders.items ?? []).slice(0, topN),
      supply,
    );
    if (maxEoaShare > maxFraction) {
      return failContract(CONCENTRATED_DETAIL, balancesEvidence);
    }
  } catch {
    return failContract(HOLDERS_UNREADABLE_DETAIL, balancesEvidence);
  }

  return {
    id: "contract",
    name: CONTRACT_CHECK_NAME,
    passed: true,
    evidenceUrl: codeEvidence,
  };
}

function failContract(detail: string, evidenceUrl: string): GateCheck {
  return {
    id: "contract",
    name: CONTRACT_CHECK_NAME,
    passed: false,
    detail,
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
