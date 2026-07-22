import { createHash, randomBytes } from "node:crypto";

import {
  completeBackupVerification,
  redeemProvisioningCode,
  type RedeemedAgent,
} from "./api-client.js";
import { exportAndVerifyBackup } from "./backup.js";
import {
  generateEncryptedKeystore,
  loadWalletFromKeystore,
  writeKeystoreFile,
  type LocalWallet,
} from "./keystore.js";
import {
  bindingPath,
  keystorePath,
  profilePath,
  resolveConvictionPaths,
  type ConvictionPaths,
} from "./paths.js";
import {
  readAgentProfile,
  readProvisioningBinding,
  writeAgentProfile,
  writeProvisioningBinding,
  type AgentProfile,
  type ProvisioningBinding,
} from "./profile.js";
import {
  buildBackupVerifiedMessage,
  buildProvisioningProofMessage,
} from "./proof.js";
import {
  KEYSTORE_PASSWORD_ENV,
  PRIVATE_KEY_ENV,
  requireUnlockSecret,
  unlockAccountForSigner,
  UnlockSecretError,
  type UnlockSecretStore,
} from "./unlock-secret.js";

export type InitOptions = {
  code: string;
  backupPath: string;
  recoveryPassphrase: string;
  apiBaseUrl: string;
  profileName?: string;
  home?: string;
  unlockStore: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export type InitResult = {
  profile: AgentProfile;
  profilePath: string;
  backupPath: string;
  depositAddress: string;
};

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function defaultProfileName(handle: string): string {
  return handle.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

function createUnlockSecret(env: NodeJS.ProcessEnv): string {
  if (env[PRIVATE_KEY_ENV]?.trim()) {
    throw new UnlockSecretError(
      `${PRIVATE_KEY_ENV} is not supported. Use an encrypted keystore unlock secret via the OS credential store or ${KEYSTORE_PASSWORD_ENV}.`,
    );
  }
  return env[KEYSTORE_PASSWORD_ENV]?.trim() || randomBytes(32).toString("base64url");
}

async function loadWalletForBinding(options: {
  binding: ProvisioningBinding;
  unlockStore: UnlockSecretStore;
  env: NodeJS.ProcessEnv;
}): Promise<LocalWallet> {
  const secret = requireUnlockSecret({
    signerAddress: options.binding.signerAddress,
    store: options.unlockStore,
    env: options.env,
  });
  const wallet = await loadWalletFromKeystore(
    options.binding.keystorePath,
    secret,
  );
  if (
    wallet.address.toLowerCase() !==
    options.binding.signerAddress.toLowerCase()
  ) {
    throw new Error(
      "Provisioning binding does not match the encrypted keystore address.",
    );
  }
  return wallet;
}

async function loadOrCreateWallet(options: {
  paths: ConvictionPaths;
  binding: ProvisioningBinding | null;
  profileName: string;
  unlockStore: UnlockSecretStore;
  env: NodeJS.ProcessEnv;
}): Promise<{ wallet: LocalWallet; binding: ProvisioningBinding }> {
  if (options.binding) {
    const wallet = await loadWalletForBinding({
      binding: options.binding,
      unlockStore: options.unlockStore,
      env: options.env,
    });
    return { wallet, binding: options.binding };
  }

  const secret = createUnlockSecret(options.env);
  const generated = await generateEncryptedKeystore(secret);
  options.unlockStore.set(unlockAccountForSigner(generated.address), secret);

  const keystoreFile = keystorePath(options.paths, options.profileName);
  await writeKeystoreFile(keystoreFile, generated.keystoreJson);

  const binding: ProvisioningBinding = {
    version: 1,
    codeHash: "",
    profileName: options.profileName,
    keystorePath: keystoreFile,
    signerAddress: generated.address,
    apiBaseUrl: "",
    redeemed: false,
    backupVerified: false,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  return { wallet: generated.wallet, binding };
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const env = options.env ?? process.env;
  if (env[PRIVATE_KEY_ENV]?.trim()) {
    throw new Error(
      "CONVICTION_PRIVATE_KEY is not supported. Local init generates an encrypted keystore instead.",
    );
  }
  if (!options.recoveryPassphrase.trim()) {
    throw new Error(
      "Provide a recovery passphrase via --backup-passphrase or CONVICTION_BACKUP_PASSPHRASE.",
    );
  }
  if (!options.backupPath.trim()) {
    throw new Error("Provide --backup-path for the encrypted signer backup.");
  }

  const home = options.home ?? env.CONVICTION_HOME;
  const paths = resolveConvictionPaths(home);
  const codeHash = hashCode(options.code);
  const statePath = bindingPath(paths, codeHash);
  const existingBinding = await readProvisioningBinding(statePath);

  const profileName =
    options.profileName?.trim() ||
    existingBinding?.profileName ||
    `agent-${codeHash.slice(0, 8)}`;

  const { wallet, binding } = await loadOrCreateWallet({
    paths,
    binding: existingBinding,
    profileName,
    unlockStore: options.unlockStore,
    env,
  });

  binding.codeHash = codeHash;
  binding.apiBaseUrl = (
    binding.apiBaseUrl || options.apiBaseUrl
  ).replace(/\/$/, "");
  if (!options.profileName?.trim() && existingBinding?.profileName) {
    binding.profileName = existingBinding.profileName;
  }
  if (!binding.createdAt) {
    binding.createdAt = (options.now?.() ?? new Date()).toISOString();
  }
  await writeProvisioningBinding(statePath, binding);

  let agent: RedeemedAgent | null = null;
  if (!binding.redeemed || !binding.agentId) {
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );
    agent = await redeemProvisioningCode({
      apiBaseUrl: binding.apiBaseUrl,
      code: options.code,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    binding.redeemed = true;
    binding.agentId = agent.agentId;
    await writeProvisioningBinding(statePath, binding);
  }

  if (!binding.agentId) {
    throw new Error("Provisioning redeem did not return an agent identity.");
  }

  if (!binding.backupVerified) {
    await exportAndVerifyBackup({
      wallet,
      recoveryPassphrase: options.recoveryPassphrase,
      backupPath: options.backupPath,
    });
    const proofSignature = await wallet.signMessage(
      buildBackupVerifiedMessage(binding.agentId, wallet.address),
    );
    agent = await completeBackupVerification({
      apiBaseUrl: binding.apiBaseUrl,
      agentId: binding.agentId,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    binding.backupVerified = true;
    await writeProvisioningBinding(statePath, binding);
  }

  if (!agent) {
    const proofSignature = await wallet.signMessage(
      buildBackupVerifiedMessage(binding.agentId, wallet.address),
    );
    agent = await completeBackupVerification({
      apiBaseUrl: binding.apiBaseUrl,
      agentId: binding.agentId,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  if (!agent.fundingReady) {
    throw new Error(
      "Backup verification did not unlock funding. Retry init with the same code and local profile.",
    );
  }
  if (!agent.address) {
    throw new Error("Redeemed agent is missing its Universal Account address.");
  }

  const finalProfileName =
    options.profileName?.trim() ||
    (binding.completed ? binding.profileName : null) ||
    defaultProfileName(agent.handle);

  const profile: AgentProfile = {
    version: 1,
    profileName: finalProfileName,
    agentId: agent.agentId,
    handle: agent.handle,
    operatorHandle: agent.operatorHandle,
    signerAddress: wallet.address,
    universalAccountAddress: agent.address,
    keystorePath: binding.keystorePath,
    apiBaseUrl: binding.apiBaseUrl,
    fundingReady: true,
    actionPolicy: agent.actionPolicy,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    createdAt: binding.createdAt,
  };

  // Prefer refreshing an already-written completed profile in place.
  if (binding.completed) {
    try {
      const previous = await readAgentProfile(
        profilePath(paths, binding.profileName),
      );
      profile.profileName = previous.profileName;
      profile.createdAt = previous.createdAt;
      profile.keystorePath = previous.keystorePath;
      if (previous.apiBaseUrl) {
        profile.apiBaseUrl = previous.apiBaseUrl;
      }
    } catch {
      // Profile file missing; write using finalProfileName below.
    }
  }

  const writtenProfilePath = profilePath(paths, profile.profileName);
  await writeAgentProfile(writtenProfilePath, profile);

  binding.profileName = profile.profileName;
  binding.completed = true;
  binding.backupVerified = true;
  binding.redeemed = true;
  await writeProvisioningBinding(statePath, binding);

  return {
    profile,
    profilePath: writtenProfilePath,
    backupPath: options.backupPath,
    depositAddress: agent.address,
  };
}

export function describeInitUnlockHint(env: NodeJS.ProcessEnv = process.env): string {
  if (env[KEYSTORE_PASSWORD_ENV]?.trim()) {
    return `Using ${KEYSTORE_PASSWORD_ENV} for keystore unlock.`;
  }
  return "Generated a machine unlock secret and stored it under the signer address in the local credential store.";
}
