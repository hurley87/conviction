import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { HDNodeWallet, Wallet } from "ethers";

const OWNER_READ_WRITE = 0o600;

/** ethers v6 createRandom returns HDNodeWallet; decrypt returns Wallet. */
export type LocalWallet = Wallet | HDNodeWallet;

export type GeneratedKeystore = {
  address: string;
  wallet: LocalWallet;
  keystoreJson: string;
};

/** Generate a fresh EOA and encrypt it as an ethers v6 scrypt JSON keystore. */
export async function generateEncryptedKeystore(
  unlockSecret: string,
): Promise<GeneratedKeystore> {
  const wallet = Wallet.createRandom();
  const keystoreJson = await wallet.encrypt(unlockSecret);
  return {
    address: wallet.address,
    wallet,
    keystoreJson,
  };
}

/** Persist a keystore with owner-only 0600 permissions. */
export async function writeKeystoreFile(
  filePath: string,
  keystoreJson: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${keystoreJson}\n`, { encoding: "utf8", mode: OWNER_READ_WRITE });
  await chmod(filePath, OWNER_READ_WRITE);
}

export async function loadWalletFromKeystore(
  filePath: string,
  unlockSecret: string,
): Promise<LocalWallet> {
  const keystoreJson = await readFile(filePath, "utf8");
  return Wallet.fromEncryptedJson(keystoreJson.trim(), unlockSecret);
}

/** Re-encrypt an in-memory wallet under a different passphrase (backup). */
export async function encryptWalletBackup(
  wallet: LocalWallet,
  recoveryPassphrase: string,
): Promise<string> {
  return wallet.encrypt(recoveryPassphrase);
}

export async function decryptBackupToAddress(
  backupJson: string,
  recoveryPassphrase: string,
): Promise<string> {
  const wallet = await Wallet.fromEncryptedJson(
    backupJson.trim(),
    recoveryPassphrase,
  );
  return wallet.address;
}
