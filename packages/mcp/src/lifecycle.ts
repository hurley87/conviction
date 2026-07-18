import {
  disableAgentLifecycle,
  enableAgentLifecycle,
  type LifecycleMutationResult,
} from "./live-api-client.js";
import { loadWalletFromKeystore } from "./keystore.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile } from "./profile.js";
import {
  resolveUnlockStore,
  requireUnlockSecret,
  type UnlockSecretStore,
} from "./unlock-secret.js";

export type LifecycleOptions = {
  profileName: string;
  apiBaseUrl: string;
  home?: string;
  unlockStore?: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

async function withProfileWallet(
  options: LifecycleOptions,
): Promise<{
  wallet: Awaited<ReturnType<typeof loadWalletFromKeystore>>;
  handle: string;
  profileName: string;
}> {
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
  return {
    wallet,
    handle: profile.handle,
    profileName: profile.profileName,
  };
}

export async function runDisable(
  options: LifecycleOptions,
): Promise<LifecycleMutationResult> {
  const { wallet } = await withProfileWallet(options);
  return disableAgentLifecycle({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export async function runEnable(
  options: LifecycleOptions,
): Promise<LifecycleMutationResult> {
  const { wallet } = await withProfileWallet(options);
  return enableAgentLifecycle({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export function formatLifecycleOutput(
  action: "disable" | "enable",
  result: LifecycleMutationResult,
): string {
  const lines = [
    `Agent @${result.agent.handle} ${action === "disable" ? "disabled" : "enabled"}.`,
    `Private status: ${result.agent.status}`,
    `Public status: ${result.agent.publicStatus}`,
  ];
  if (result.privatePausedReason) {
    lines.push(result.privatePausedReason);
  }
  if (result.releasedPermitCount > 0) {
    lines.push(`Released ${result.releasedPermitCount} outstanding permit(s).`);
  }
  return lines.join("\n");
}
