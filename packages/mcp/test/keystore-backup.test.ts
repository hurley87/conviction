import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exportAndVerifyBackup } from "../src/backup.js";
import {
  decryptBackupToAddress,
  generateEncryptedKeystore,
  loadWalletFromKeystore,
  writeKeystoreFile,
} from "../src/keystore.js";
import {
  KEYSTORE_PASSWORD_ENV,
  MemoryUnlockSecretStore,
  PRIVATE_KEY_ENV,
  resolveOrCreateUnlockSecret,
  UnlockSecretError,
} from "../src/unlock-secret.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("keystore and backup", () => {
  it("writes a 0600 ethers keystore and decrypts to the same address", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "conviction-keystore-"));
    cleanup.push(root);
    const file = path.join(root, "agent.json");
    const generated = await generateEncryptedKeystore("unlock-secret");
    await writeKeystoreFile(file, generated.keystoreJson);

    const mode = (await stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = await loadWalletFromKeystore(file, "unlock-secret");
    expect(loaded.address).toBe(generated.address);
    expect(JSON.stringify(generated.keystoreJson)).not.toMatch(/privateKey/i);
  });

  it("re-encrypts a backup and verifies the recovered address", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "conviction-backup-"));
    cleanup.push(root);
    const generated = await generateEncryptedKeystore("unlock-secret");
    const backupPath = path.join(root, "agent.backup.json");

    const verified = await exportAndVerifyBackup({
      wallet: generated.wallet,
      recoveryPassphrase: "recovery-passphrase",
      backupPath,
    });

    expect(verified.address).toBe(generated.address);
    const again = await decryptBackupToAddress(
      await readFile(backupPath, "utf8"),
      "recovery-passphrase",
    );
    expect(again).toBe(generated.address);
  });

  it("rejects raw private-key environment configuration", () => {
    const store = new MemoryUnlockSecretStore();
    expect(() =>
      resolveOrCreateUnlockSecret({
        account: "signer:0x0000000000000000000000000000000000000001",
        store,
        env: {
          [PRIVATE_KEY_ENV]: "0xabc",
          [KEYSTORE_PASSWORD_ENV]: "ok",
        },
      }),
    ).toThrow(UnlockSecretError);
  });
});
