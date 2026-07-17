import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  decryptBackupToAddress,
  encryptWalletBackup,
  type LocalWallet,
} from "./keystore.js";

const OWNER_READ_WRITE = 0o600;

export type BackupVerification = {
  backupPath: string;
  address: string;
};

/**
 * Export a separately passphrase-encrypted backup and decrypt-verify the address.
 */
export async function exportAndVerifyBackup(options: {
  wallet: LocalWallet;
  recoveryPassphrase: string;
  backupPath: string;
}): Promise<BackupVerification> {
  if (!options.recoveryPassphrase.trim()) {
    throw new Error("A recovery passphrase is required for the signer backup.");
  }

  const backupJson = await encryptWalletBackup(
    options.wallet,
    options.recoveryPassphrase,
  );
  const absolutePath = path.resolve(options.backupPath);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, `${backupJson}\n`, {
    encoding: "utf8",
    mode: OWNER_READ_WRITE,
  });
  await chmod(absolutePath, OWNER_READ_WRITE);

  const verifiedAddress = await decryptBackupToAddress(
    backupJson,
    options.recoveryPassphrase,
  );
  if (verifiedAddress.toLowerCase() !== options.wallet.address.toLowerCase()) {
    throw new Error(
      "Backup decrypt-verification failed: recovered address does not match the local signer.",
    );
  }

  return { backupPath: absolutePath, address: verifiedAddress };
}
