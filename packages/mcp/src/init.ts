import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";

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
  incompletePath,
  keystorePath,
  profilePath,
  resolveConvictionPaths,
  type ConvictionPaths,
} from "./paths.js";
import {
  readAgentProfile,
  readIncompleteInit,
  writeAgentProfile,
  writeIncompleteInit,
  type AgentProfile,
  type IncompleteInit,
} from "./profile.js";
import {
  buildBackupVerifiedMessage,
  buildProvisioningProofMessage,
} from "./proof.js";
import {
  KEYSTORE_PASSWORD_ENV,
  resolveOrCreateUnlockSecret,
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

async function loadOrCreateWallet(options: {
  paths: ConvictionPaths;
  incomplete: IncompleteInit | null;
  existingProfile: AgentProfile | null;
  profileName: string;
  unlockStore: UnlockSecretStore;
  env: NodeJS.ProcessEnv;
}): Promise<{ wallet: LocalWallet; keystoreFile: string; incomplete: IncompleteInit }> {
  const { secret } = resolveOrCreateUnlockSecret({
    profileName: options.profileName,
    store: options.unlockStore,
    env: options.env,
  });

  if (options.incomplete) {
    const wallet = await loadWalletFromKeystore(
      options.incomplete.keystorePath,
      secret,
    );
    if (
      wallet.address.toLowerCase() !==
      options.incomplete.signerAddress.toLowerCase()
    ) {
      throw new Error(
        "Incomplete provisioning state does not match the encrypted keystore address.",
      );
    }
    return {
      wallet,
      keystoreFile: options.incomplete.keystorePath,
      incomplete: options.incomplete,
    };
  }

  if (options.existingProfile) {
    const wallet = await loadWalletFromKeystore(
      options.existingProfile.keystorePath,
      secret,
    );
    if (
      wallet.address.toLowerCase() !==
      options.existingProfile.signerAddress.toLowerCase()
    ) {
      throw new Error(
        "Existing profile does not match the encrypted keystore address.",
      );
    }
    const incomplete: IncompleteInit = {
      version: 1,
      codeHash: "",
      profileName: options.existingProfile.profileName,
      keystorePath: options.existingProfile.keystorePath,
      signerAddress: options.existingProfile.signerAddress,
      apiBaseUrl: "",
      redeemed: true,
      agentId: options.existingProfile.agentId,
      backupVerified: options.existingProfile.fundingReady,
      createdAt: options.existingProfile.createdAt,
    };
    return {
      wallet,
      keystoreFile: options.existingProfile.keystorePath,
      incomplete,
    };
  }

  const generated = await generateEncryptedKeystore(secret);
  const keystoreFile = keystorePath(options.paths, options.profileName);
  await writeKeystoreFile(keystoreFile, generated.keystoreJson);
  const incomplete: IncompleteInit = {
    version: 1,
    codeHash: "",
    profileName: options.profileName,
    keystorePath: keystoreFile,
    signerAddress: generated.address,
    apiBaseUrl: "",
    redeemed: false,
    backupVerified: false,
    createdAt: new Date().toISOString(),
  };
  return { wallet: generated.wallet, keystoreFile, incomplete };
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const env = options.env ?? process.env;
  if (env.CONVICTION_PRIVATE_KEY?.trim()) {
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
  const resumePath = incompletePath(paths, codeHash);
  const existingIncomplete = await readIncompleteInit(resumePath);

  const profileName =
    options.profileName?.trim() ||
    existingIncomplete?.profileName ||
    `agent-${codeHash.slice(0, 8)}`;

  let existingProfile: AgentProfile | null = null;
  try {
    existingProfile = await readAgentProfile(profilePath(paths, profileName));
  } catch {
    existingProfile = null;
  }

  // After a successful first run the profile name becomes the agent handle.
  if (!existingProfile && existingIncomplete?.profileName) {
    try {
      existingProfile = await readAgentProfile(
        profilePath(paths, existingIncomplete.profileName),
      );
    } catch {
      existingProfile = null;
    }
  }

  const resolvedProfileName = existingProfile?.profileName ?? profileName;
  const { wallet, incomplete } = await loadOrCreateWallet({
    paths,
    incomplete: existingIncomplete,
    existingProfile,
    profileName: resolvedProfileName,
    unlockStore: options.unlockStore,
    env,
  });

  incomplete.codeHash = codeHash;
  incomplete.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
  incomplete.profileName = resolvedProfileName;
  if (!incomplete.createdAt) {
    incomplete.createdAt = (options.now?.() ?? new Date()).toISOString();
  }
  await writeIncompleteInit(resumePath, incomplete);

  let agent: RedeemedAgent | null = null;
  if (!incomplete.redeemed || !incomplete.agentId) {
    const proofSignature = await wallet.signMessage(
      buildProvisioningProofMessage(codeHash, wallet.address),
    );
    const redeemArgs = {
      apiBaseUrl: incomplete.apiBaseUrl,
      code: options.code,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };
    agent = await redeemProvisioningCode(redeemArgs);
    incomplete.redeemed = true;
    incomplete.agentId = agent.agentId;
    await writeIncompleteInit(resumePath, incomplete);
  }

  if (!incomplete.agentId) {
    throw new Error("Provisioning redeem did not return an agent identity.");
  }

  if (!incomplete.backupVerified) {
    await exportAndVerifyBackup({
      wallet,
      recoveryPassphrase: options.recoveryPassphrase,
      backupPath: options.backupPath,
    });
    const proofSignature = await wallet.signMessage(
      buildBackupVerifiedMessage(incomplete.agentId, wallet.address),
    );
    const completeArgs = {
      apiBaseUrl: incomplete.apiBaseUrl,
      agentId: incomplete.agentId,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };
    agent = await completeBackupVerification(completeArgs);
    incomplete.backupVerified = true;
    await writeIncompleteInit(resumePath, incomplete);
  }

  if (!agent) {
    const proofSignature = await wallet.signMessage(
      buildBackupVerifiedMessage(incomplete.agentId, wallet.address),
    );
    const completeArgs = {
      apiBaseUrl: incomplete.apiBaseUrl,
      agentId: incomplete.agentId,
      signerAddress: wallet.address,
      proofSignature,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };
    agent = await completeBackupVerification(completeArgs);
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
    options.profileName?.trim() || defaultProfileName(agent.handle);

  const profile: AgentProfile = {
    version: 1,
    profileName: finalProfileName,
    agentId: agent.agentId,
    handle: agent.handle,
    operatorHandle: agent.operatorHandle,
    signerAddress: wallet.address,
    universalAccountAddress: agent.address,
    keystorePath: incomplete.keystorePath,
    fundingReady: true,
    actionPolicy: agent.actionPolicy,
    maxTradeUsd: agent.maxTradeUsd,
    spendBudgetUsd: agent.spendBudgetUsd,
    createdAt: incomplete.createdAt,
  };

  const writtenProfilePath = profilePath(paths, finalProfileName);
  await writeAgentProfile(writtenProfilePath, profile);
  await rm(resumePath, { force: true });

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
  return "Generated a machine unlock secret and stored it in the local credential store.";
}
