// The Universal Account adapter — the seam the verb layer calls. The UA SDK
// lives behind this so it can be mocked for fast unit coverage (ADR 0014).

import type { UniversalBalance, DepositAddresses } from "@/lib/verbs/types";

export type UpgradeResult = { upgraded: boolean; alreadyUpgraded: boolean };

export interface UAClient {
  /** getUniversalBalance() verb — wraps the SDK's getPrimaryAssets(). */
  getUniversalBalance(): Promise<UniversalBalance>;
  /** getDepositAddresses() verb — wraps the SDK's getSmartAccountOptions(). */
  getDepositAddresses(): Promise<DepositAddresses>;
  /** One-time EIP-7702 upgrade of the owner EOA in place (ADR 0004). */
  ensureUpgraded(): Promise<UpgradeResult>;
}
