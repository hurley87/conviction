import { inspect } from "node:util";

import {
  fetchAgentStatus,
  type LiveAgentStatus,
} from "./live-api-client.js";
import { loadWalletFromKeystore } from "./keystore.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile } from "./profile.js";
import {
  resolveUnlockStore,
  requireUnlockSecret,
  type UnlockSecretStore,
} from "./unlock-secret.js";

export type StatusOptions = {
  profileName: string;
  apiBaseUrl: string;
  home?: string;
  unlockStore?: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export async function runStatus(
  options: StatusOptions,
): Promise<LiveAgentStatus> {
  const env = options.env ?? process.env;
  const paths = resolveConvictionPaths(options.home);
  const profile = await readAgentProfile(
    profilePath(paths, options.profileName),
  );
  const { store } = await resolveUnlockStore(env, options.unlockStore);
  const unlockSecret = requireUnlockSecret({
    signerAddress: profile.signerAddress,
    store,
    env,
  });
  const wallet = await loadWalletFromKeystore(profile.keystorePath, unlockSecret);
  return fetchAgentStatus({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export function formatStatusOutput(status: LiveAgentStatus): string {
  return inspect(
    {
      handle: status.handle,
      agentId: status.agentId,
      status: status.status,
      publicStatus: status.publicStatus,
      fundingReady: status.fundingReady,
      setupVerifiedAt: status.setupVerifiedAt,
      depositAddress: status.depositAddress,
      remainingBudgetUsd: status.remainingBudgetUsd,
      actionPolicy: status.actionPolicy,
    },
    { colors: false, depth: 3, compact: false },
  );
}
