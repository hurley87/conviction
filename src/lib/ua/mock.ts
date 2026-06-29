// Deterministic mock UA client. Used by unit tests (ADR 0014) and as the
// local-dev fallback when Particle/Privy env is not configured, so the app and
// its tests run with zero credentials and no real funds.

import type { UAClient, UpgradeResult } from "@/lib/ua/types";
import type { UniversalBalance, DepositAddresses } from "@/lib/verbs/types";
import { sumSources } from "@/lib/verbs/map-balance";

export type MockSeed = {
  /** Deposits across ≥2 chains, to mirror the unified-balance demo. */
  sources?: UniversalBalance["sources"];
  evm?: string;
  solana?: string | null;
};

const DEFAULT_SOURCES: UniversalBalance["sources"] = [
  { chain: "Arbitrum", asset: "USDC", usd: 180.0 },
  { chain: "Base", asset: "ETH", usd: 62.5 },
];

export class MockUAClient implements UAClient {
  private upgraded = false;
  constructor(private readonly seed: MockSeed = {}) {}

  async getUniversalBalance(): Promise<UniversalBalance> {
    const sources = this.seed.sources ?? DEFAULT_SOURCES;
    return {
      totalUsd: sumSources(sources),
      sources,
    };
  }

  async getDepositAddresses(): Promise<DepositAddresses> {
    return {
      evm: this.seed.evm ?? "0xMockEOAUpgradedInPlace000000000000000000",
      solana: this.seed.solana ?? null,
    };
  }

  async ensureUpgraded(): Promise<UpgradeResult> {
    const alreadyUpgraded = this.upgraded;
    this.upgraded = true;
    return { upgraded: !alreadyUpgraded, alreadyUpgraded };
  }
}
