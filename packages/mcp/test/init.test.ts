import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { Wallet, verifyMessage } from "ethers";

import { runInit } from "../src/init.js";
import { readAgentProfile } from "../src/profile.js";
import {
  buildBackupVerifiedMessage,
  buildProvisioningProofMessage,
} from "../src/proof.js";
import { MemoryUnlockSecretStore } from "../src/unlock-secret.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

describe("runInit", () => {
  it("redeems, verifies backup, and writes a funding-ready profile without leaking keys", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-init-"));
    cleanup.push(home);
    const backupPath = path.join(home, "backup.json");
    const code = "one-time-provisioning-code";
    const codeHash = hashCode(code);
    const agentId = "00000000-0000-4000-8000-000000000111";

    let redeemCount = 0;
    let completeCount = 0;

    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        code?: string;
        signerAddress?: string;
        proofSignature?: string;
        agentId?: string;
      };

      if (String(_input).endsWith("/api/agents/redeem")) {
        redeemCount += 1;
        const message = buildProvisioningProofMessage(
          codeHash,
          body.signerAddress!,
        );
        const recovered = verifyMessage(message, body.proofSignature!);
        expect(recovered).toBe(body.signerAddress);
        expect(body.code).toBe(code);
        return new Response(
          JSON.stringify({
            agent: {
              agentId,
              handle: "signal-scout",
              operatorHandle: "operator",
              address: body.signerAddress,
              status: "active",
              publicStatus: "active",
              actionPolicy: { trade: true, back: true, publish: false },
              maxTradeUsd: 25,
              spendBudgetUsd: 100,
              fundingReady: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (String(_input).endsWith("/api/agents/complete-backup")) {
        completeCount += 1;
        const message = buildBackupVerifiedMessage(agentId, body.signerAddress!);
        expect(verifyMessage(message, body.proofSignature!)).toBe(
          body.signerAddress,
        );
        return new Response(
          JSON.stringify({
            agent: {
              agentId,
              handle: "signal-scout",
              operatorHandle: "operator",
              address: body.signerAddress,
              status: "active",
              publicStatus: "active",
              actionPolicy: { trade: true, back: true, publish: false },
              maxTradeUsd: 25,
              spendBudgetUsd: 100,
              fundingReady: true,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    };

    const unlockStore = new MemoryUnlockSecretStore();
    const result = await runInit({
      code,
      backupPath,
      recoveryPassphrase: "recovery-passphrase",
      apiBaseUrl: "http://conviction.test",
      home,
      unlockStore,
      fetchImpl,
      env: {
        CONVICTION_KEYSTORE_PASSWORD: "machine-unlock-secret",
      },
    });

    expect(redeemCount).toBe(1);
    expect(completeCount).toBe(1);
    expect(result.profile.fundingReady).toBe(true);
    expect(result.depositAddress).toBe(result.profile.signerAddress);
    expect(result.profile.handle).toBe("signal-scout");

    const profile = await readAgentProfile(result.profilePath);
    expect(profile.universalAccountAddress).toBe(result.depositAddress);
    expect(profile.profileName).toBe("signal-scout");

    const serialized = JSON.stringify({
      profile,
      backup: await readFile(backupPath, "utf8"),
    });
    expect(serialized).not.toContain("recovery-passphrase");
    expect(serialized).not.toContain("machine-unlock-secret");
    expect(serialized).not.toMatch(/"privateKey"\s*:/);
    expect(serialized).not.toMatch(/"mnemonic"\s*:/);

    // Resume with only --code (no --profile) must not mint another signer.
    const again = await runInit({
      code,
      backupPath: path.join(home, "backup-2.json"),
      recoveryPassphrase: "recovery-passphrase",
      apiBaseUrl: "http://conviction.test",
      home,
      unlockStore: new MemoryUnlockSecretStore(),
      fetchImpl,
      env: {
        CONVICTION_KEYSTORE_PASSWORD: "machine-unlock-secret",
      },
    });
    expect(again.profile.signerAddress).toBe(result.profile.signerAddress);
    expect(again.profile.profileName).toBe("signal-scout");
    expect(Wallet.createRandom().address).not.toBe(again.profile.signerAddress);
    expect(redeemCount).toBe(1);
  });

  it("rejects raw private key env vars", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-init-reject-"));
    cleanup.push(home);
    await expect(
      runInit({
        code: "code",
        backupPath: path.join(home, "backup.json"),
        recoveryPassphrase: "pass",
        apiBaseUrl: "http://conviction.test",
        home,
        unlockStore: new MemoryUnlockSecretStore(),
        env: { CONVICTION_PRIVATE_KEY: "0xdead" },
      }),
    ).rejects.toThrow(/CONVICTION_PRIVATE_KEY/);
  });
});
