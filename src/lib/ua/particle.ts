// Real Universal Account client backed by Particle's SDK in EIP-7702 mode
// (ADR 0004). The SDK is dynamically imported so it never executes during SSR
// or the static build — only client-side at call time.
//
// Reads (balance, deposit addresses) are fully wired here. The on-chain 7702
// authorization signature is produced with the owner's signer in the React
// layer (see useConvictionAccount) and submitted with the first transaction
// (issue #2); ensureUpgraded() here is a read-side no-op. Pending Particle
// office-hours confirmation of the exact 7702 config (docs/adr/0000).

import type { UAClient, UpgradeResult } from "@/lib/ua/types";
import type { UniversalBalance, DepositAddresses } from "@/lib/verbs/types";
import { toUniversalBalance, type RawPrimaryAssets } from "@/lib/verbs/map-balance";

export type ParticleConfig = {
  ownerAddress: string;
  projectId: string;
  projectClientKey: string;
  projectAppUuid: string;
};

export function createParticleUAClient(config: ParticleConfig): UAClient {
  // Build the SDK account lazily; cache the promise across calls.
  let accountPromise: Promise<unknown> | null = null;
  async function account() {
    if (!accountPromise) {
      accountPromise = (async () => {
        const { UniversalAccount } = await import(
          "@particle-network/universal-account-sdk"
        );
        return new UniversalAccount({
          projectId: config.projectId,
          projectClientKey: config.projectClientKey,
          projectAppUuid: config.projectAppUuid,
          ownerAddress: config.ownerAddress,
          // Upgrade the existing EOA in place — no new address (ADR 0004).
          smartAccountOptions: { useEIP7702: true },
        });
      })();
    }
    return accountPromise as Promise<{
      getPrimaryAssets(): Promise<RawPrimaryAssets>;
      getSmartAccountOptions(): Promise<{
        smartAccountAddress?: string;
        solanaSmartAccountAddress?: string;
        ownerAddress: string;
      }>;
    }>;
  }

  return {
    async getUniversalBalance(): Promise<UniversalBalance> {
      const ua = await account();
      return toUniversalBalance(await ua.getPrimaryAssets());
    },

    async getDepositAddresses(): Promise<DepositAddresses> {
      const ua = await account();
      const opts = await ua.getSmartAccountOptions();
      return {
        evm: opts.smartAccountAddress ?? config.ownerAddress,
        solana: opts.solanaSmartAccountAddress ?? null,
      };
    },

    async ensureUpgraded(): Promise<UpgradeResult> {
      // The 7702 authorization is signed via Privy in the React layer and
      // submitted with the first transaction (issue #2). Reads need no upgrade.
      return { upgraded: false, alreadyUpgraded: true };
    },
  };
}
