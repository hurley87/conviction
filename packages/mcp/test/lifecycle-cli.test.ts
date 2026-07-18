import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import {
  generateEncryptedKeystore,
  writeKeystoreFile,
} from "../src/keystore.js";
import {
  keystorePath,
  profilePath,
  resolveConvictionPaths,
} from "../src/paths.js";
import { writeAgentProfile } from "../src/profile.js";

describe("conviction-mcp disable/enable CLI", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((fn) => fn()));
  });

  it("routes disable and enable through signed lifecycle endpoints", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-lifecycle-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));

    const unlockSecret = "lifecycle-unlock-secret";
    const generated = await generateEncryptedKeystore(unlockSecret);
    const paths = resolveConvictionPaths(home);
    const profileName = "scout";
    await writeKeystoreFile(
      keystorePath(paths, profileName),
      generated.keystoreJson,
    );
    await writeAgentProfile(profilePath(paths, profileName), {
      version: 1,
      profileName,
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      handle: "scout",
      operatorHandle: "operator",
      signerAddress: generated.address,
      universalAccountAddress: generated.address,
      keystorePath: keystorePath(paths, profileName),
      fundingReady: true,
      actionPolicy: { trade: true, back: true, publish: true },
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      createdAt: "2026-07-18T12:00:00.000Z",
    });

    const calls: Array<{ method: string; path: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const pathname = new URL(url).pathname;
      calls.push({ method: String(init?.method ?? "GET"), path: pathname });
      const headers = init?.headers as Record<string, string>;
      expect(headers["x-conviction-agent"]).toBeTruthy();
      expect(headers["x-conviction-signature"]).toBeTruthy();
      return new Response(
        JSON.stringify({
          agent: {
            agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            handle: "scout",
            status: pathname.endsWith("/disable") ? "disabled" : "active",
            publicStatus: pathname.endsWith("/disable") ? "paused" : "active",
            actionPolicy: { trade: true, back: true, publish: true },
            maxTradeUsd: 25,
            spendBudgetUsd: 100,
            lifetimeSpendUsd: 0,
          },
          releasedPermitCount: pathname.endsWith("/disable") ? 1 : 0,
          privatePausedReason: pathname.endsWith("/disable")
            ? "This agent is independently disabled."
            : null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };

    const previousPassword = process.env.CONVICTION_KEYSTORE_PASSWORD;
    process.env.CONVICTION_KEYSTORE_PASSWORD = unlockSecret;

    try {
      await runCli([
        "disable",
        "--profile",
        profileName,
        "--home",
        home,
        "--api-base",
        "http://127.0.0.1:3999",
      ]);
      await runCli([
        "enable",
        "--profile",
        profileName,
        "--home",
        home,
        "--api-base",
        "http://127.0.0.1:3999",
      ]);
    } finally {
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (previousPassword === undefined) {
        delete process.env.CONVICTION_KEYSTORE_PASSWORD;
      } else {
        process.env.CONVICTION_KEYSTORE_PASSWORD = previousPassword;
      }
    }

    expect(calls).toEqual([
      { method: "POST", path: "/api/agents/lifecycle/disable" },
      { method: "POST", path: "/api/agents/lifecycle/enable" },
    ]);
    expect(logs.join("\n")).toMatch(/disabled/i);
    expect(logs.join("\n")).toMatch(/enabled/i);
  });

  it("documents disable and enable in help", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };
    try {
      await runCli(["help"]);
    } finally {
      console.log = originalLog;
    }
    const help = logs.join("\n");
    expect(help).toMatch(/disable/);
    expect(help).toMatch(/enable/);
  });
});
