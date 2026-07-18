import {
  disableAgentLifecycle,
  enableAgentLifecycle,
  recoverAgentRetirement,
  retireAgentLifecycle,
  type LifecycleMutationResult,
  type RetirementMutationResult,
} from "./live-api-client.js";
import { loadWalletFromKeystore } from "./keystore.js";
import { createLocalTradeSigners } from "./local-trade-signers.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile } from "./profile.js";
import {
  resolveUnlockStore,
  requireUnlockSecret,
  type UnlockSecretStore,
} from "./unlock-secret.js";

const MAX_LIVE_RECOVERY_LEGS = 32;

export type LifecycleOptions = {
  profileName: string;
  apiBaseUrl: string;
  home?: string;
  unlockStore?: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  idempotencyKey?: string;
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

/**
 * Permanently retire the agent and recover canonical cash using the original
 * local signer. Conviction cannot reconstruct or replace that signer.
 *
 * Mock/local: single recover call completes in-process.
 * Live Particle: prepare → local sign → submit per leg, then finalize.
 */
export async function runRetire(
  options: LifecycleOptions,
): Promise<RetirementMutationResult> {
  const { wallet } = await withProfileWallet(options);
  let result = await retireAgentLifecycle({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    ...(options.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  if (!result.recoveryRequired) {
    return result;
  }

  const retirementId = result.retirement.retirementId;
  const signers = createLocalTradeSigners(wallet);

  // First call: mock path completes; live path returns a signable leg.
  result = await recoverAgentRetirement({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    retirementId,
    action: "prepare",
    retry: result.retirement.reconciliationState === "needs_attention",
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  for (
    let i = 0;
    i < MAX_LIVE_RECOVERY_LEGS &&
    result.recoveryRequired &&
    result.signable;
    i += 1
  ) {
    const signable = result.signable;
    const rootHashSignature = await signers.signRootHash(signable.rootHash);
    const authorizations: Array<{ userOpHash: string; signature: string }> =
      [];
    for (const pending of signable.userOpsNeeding7702) {
      authorizations.push({
        userOpHash: pending.userOpHash,
        signature: await signers.sign7702(pending.auth),
      });
    }

    result = await recoverAgentRetirement({
      apiBaseUrl: options.apiBaseUrl,
      wallet,
      retirementId,
      action: "submit",
      legId: signable.legId,
      rootHashSignature,
      ...(authorizations.length > 0 ? { authorizations } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

    if (!result.recoveryRequired) break;

    result = await recoverAgentRetirement({
      apiBaseUrl: options.apiBaseUrl,
      wallet,
      retirementId,
      action: "prepare",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  if (result.recoveryRequired && !result.signable) {
    result = await recoverAgentRetirement({
      apiBaseUrl: options.apiBaseUrl,
      wallet,
      retirementId,
      action: "finalize",
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  return result;
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

export function formatRetireOutput(result: RetirementMutationResult): string {
  const lines = [
    `Agent @${result.agent.handle} retirement: ${result.agent.status}.`,
    `Private status: ${result.agent.status}`,
    `Public status: ${result.agent.publicStatus}`,
    `Reconciliation: ${result.retirement.reconciliationState}`,
    `Recovered: $${Number(result.retirement.recoveredUsd).toFixed(2)} USDC (Arbitrum) toward the locked return address.`,
  ];
  if (result.retirement.dustUsd > 0) {
    lines.push(
      `Dust recorded: $${Number(result.retirement.dustUsd).toFixed(2)} (below $1 threshold; does not block completion).`,
    );
  }
  if (result.retirement.residualHoldings.length > 0) {
    lines.push("Residual holdings:");
    for (const holding of result.retirement.residualHoldings) {
      lines.push(
        `  - ${holding.asset} on ${holding.chain}: $${holding.usd.toFixed(2)} (${holding.reason})`,
      );
    }
  }
  if (result.retirement.lastError) {
    lines.push(`Last error: ${result.retirement.lastError}`);
  }
  if (result.privatePausedReason) {
    lines.push(result.privatePausedReason);
  }
  if (result.signerNote) {
    lines.push(result.signerNote);
  }
  if (result.releasedPermitCount > 0) {
    lines.push(`Released ${result.releasedPermitCount} outstanding permit(s).`);
  }
  if (result.recoveryRequired) {
    lines.push(
      "Recovery still needs attention. Re-run conviction-mcp retire with the original local signer.",
    );
  }
  return lines.join("\n");
}
