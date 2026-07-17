import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../src/doctor.js";
import { generateEncryptedKeystore, writeKeystoreFile } from "../src/keystore.js";
import { keystorePath, profilePath, resolveConvictionPaths } from "../src/paths.js";
import { writeAgentProfile } from "../src/profile.js";
import { MemoryUnlockSecretStore, unlockAccountForSigner } from "../src/unlock-secret.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runDoctor", () => {
  it("passes non-value-moving checks, records setup verification, then suggests funding", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-doctor-"));
    cleanup.push(home);
    const paths = resolveConvictionPaths(home);
    const unlockStore = new MemoryUnlockSecretStore();
    const secret = "test-unlock-secret";
    const generated = await generateEncryptedKeystore(secret);
    unlockStore.set(unlockAccountForSigner(generated.address), secret);

    const profileName = "signal-scout";
    await writeKeystoreFile(keystorePath(paths, profileName), generated.keystoreJson);
    await writeAgentProfile(profilePath(paths, profileName), {
      version: 1,
      profileName,
      agentId: "00000000-0000-4000-8000-000000000111",
      handle: "signal-scout",
      operatorHandle: "operator",
      signerAddress: generated.address,
      universalAccountAddress: generated.address,
      keystorePath: keystorePath(paths, profileName),
      fundingReady: true,
      actionPolicy: { trade: true, back: true, publish: true },
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      createdAt: "2026-07-17T12:00:00.000Z",
    });

    const reportPath = path.join(home, "doctor-report.json");
    let setupVerifyCalls = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/agents/status") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            status: {
              ok: true,
              mode: "live",
              agentId: "00000000-0000-4000-8000-000000000111",
              handle: "signal-scout",
              operatorHandle: "operator",
              address: generated.address,
              depositAddress: generated.address,
              status: "active",
              publicStatus: "active",
              actionPolicy: { trade: true, back: true, publish: true },
              maxTradeUsd: 25,
              spendBudgetUsd: 100,
              lifetimeSpendUsd: 0,
              remainingBudgetUsd: 100,
              fundingReady: true,
              setupVerifiedAt: null,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/agents/setup-verify") && init?.method === "POST") {
        setupVerifyCalls += 1;
        return new Response(
          JSON.stringify({
            status: {
              ok: true,
              mode: "live",
              agentId: "00000000-0000-4000-8000-000000000111",
              handle: "signal-scout",
              operatorHandle: "operator",
              address: generated.address,
              depositAddress: generated.address,
              status: "active",
              publicStatus: "active",
              actionPolicy: { trade: true, back: true, publish: true },
              maxTradeUsd: 25,
              spendBudgetUsd: 100,
              lifetimeSpendUsd: 0,
              remainingBudgetUsd: 100,
              fundingReady: true,
              setupVerifiedAt: "2026-07-17T12:05:00.000Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const result = await runDoctor({
      profileName,
      apiBaseUrl: "http://127.0.0.1:3000",
      home,
      unlockStore,
      fetchImpl,
      reportPath,
      env: {},
    });

    expect(result.ok).toBe(true);
    expect(result.suggestFunding).toBe(true);
    expect(result.depositAddress).toBe(generated.address);
    expect(setupVerifyCalls).toBe(1);
    expect(result.checks.some((check) => check.id === "backend_auth" && check.status === "pass")).toBe(
      true,
    );

    const report = await readFile(reportPath, "utf8");
    expect(report).toContain("redactions");
    expect(report).not.toContain(secret);
    expect(report).not.toContain("CONVICTION_KEYSTORE_PASSWORD=");
    expect(report).not.toContain("--code ");
  });

  it("fails closed when the profile is missing", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-doctor-missing-"));
    cleanup.push(home);
    const result = await runDoctor({
      profileName: "missing",
      apiBaseUrl: "http://127.0.0.1:3000",
      home,
      unlockStore: new MemoryUnlockSecretStore(),
      env: {},
      recordSetupVerification: false,
    });
    expect(result.ok).toBe(false);
    expect(result.suggestFunding).toBe(false);
  });
});
