import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { verifyMessage } from "ethers";

import {
  generateEncryptedKeystore,
  writeKeystoreFile,
} from "../src/keystore.js";
import { LIVE_TOOLS } from "../src/live-server.js";
import {
  assertSafeProfileName,
  keystorePath,
  profilePath,
  resolveConvictionPaths,
} from "../src/paths.js";
import { writeAgentProfile } from "../src/profile.js";
import {
  buildAgentRequestMessage,
  hashRequestBody,
} from "../src/signed-request.js";

const packageRoot = path.resolve(import.meta.dirname, "..");
const executable = path.join(packageRoot, "bin", "conviction-mcp.js");
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function startMockApi(walletAddress: string) {
  const leases = new Map<string, { leaseId: string; expiresAt: string; acquiredAt: string }>();
  const nonces = new Set<string>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const agent = String(req.headers["x-conviction-agent"] ?? "");
    const timestamp = String(req.headers["x-conviction-timestamp"] ?? "");
    const nonce = String(req.headers["x-conviction-nonce"] ?? "");
    const signature = String(req.headers["x-conviction-signature"] ?? "");

    const message = buildAgentRequestMessage({
      method: req.method ?? "GET",
      path: url.pathname,
      bodyHash: hashRequestBody(rawBody),
      timestampMs: timestamp,
      nonce,
      agentAddress: agent,
    });

    try {
      if (verifyMessage(message, signature) !== walletAddress) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "invalid_auth", message: "bad sig" } }));
        return;
      }
    } catch {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "invalid_auth", message: "bad sig" } }));
      return;
    }

    if (nonces.has(nonce)) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "replay_rejected", message: "replay" } }));
      return;
    }
    nonces.add(nonce);

    if (req.method === "GET" && url.pathname === "/api/agents/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: {
            ok: true,
            mode: "live",
            agentId: "00000000-0000-4000-8000-000000000111",
            handle: "signal-scout",
            operatorHandle: "operator",
            address: walletAddress,
            depositAddress: walletAddress,
            depositAddresses: { evm: walletAddress, solana: null },
            balance: { totalUsd: 0, sources: [] },
            status: "active",
            publicStatus: "active",
            actionPolicy: { trade: true, back: true, publish: false },
            maxTradeUsd: 25,
            spendBudgetUsd: 100,
            lifetimeSpendUsd: 0,
            remainingBudgetUsd: 100,
            fundingReady: true,
            setupVerifiedAt: null,
          },
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/lease") {
      const active = leases.get(walletAddress);
      const body = rawBody.trim() ? (JSON.parse(rawBody) as { replace?: boolean }) : {};
      if (active && !body.replace) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: "lease_conflict",
              message: "conflict",
              activeLeaseId: active.leaseId,
              activeLeaseExpiresAt: active.expiresAt,
              leaseAgeMs: 1_000,
            },
          }),
        );
        return;
      }
      const lease = {
        leaseId: `lease-${leases.size + 1}`,
        agentId: "00000000-0000-4000-8000-000000000111",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        acquiredAt: new Date().toISOString(),
      };
      leases.set(walletAddress, lease);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ lease }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/agents/lease/renew") {
      const active = leases.get(walletAddress);
      const body = JSON.parse(rawBody) as { leaseId?: string };
      if (!active || active.leaseId !== body.leaseId) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "lease_conflict", message: "replaced" } }));
        return;
      }
      active.expiresAt = new Date(Date.now() + 120_000).toISOString();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ lease: active }));
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/agents/lease") {
      leases.delete(walletAddress);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "missing" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return {
    apiBaseUrl: `http://127.0.0.1:${port}`,
    leases,
  };
}

describe("serve --profile host path", () => {
  it("rejects unsafe profile names", () => {
    expect(() => assertSafeProfileName("../evil")).toThrow(/invalid --profile name/);
    expect(() => assertSafeProfileName("a/b")).toThrow(/invalid --profile name/);
  });

  it("starts over stdio, acquires a lease, lists v1 tools, and returns status", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-live-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));

    const unlockSecret = "machine-unlock-secret";
    const generated = await generateEncryptedKeystore(unlockSecret);
    const paths = resolveConvictionPaths(home);
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
      actionPolicy: { trade: true, back: true, publish: false },
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      createdAt: "2026-07-17T12:00:00.000Z",
    });

    const api = await startMockApi(generated.address);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        executable,
        "serve",
        "--profile",
        profileName,
        "--home",
        home,
        "--api-base",
        api.apiBaseUrl,
      ],
      cwd: packageRoot,
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "",
        CONVICTION_KEYSTORE_PASSWORD: unlockSecret,
      },
      stderr: "pipe",
    });

    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const client = new Client({ name: "live-profile-host", version: "1.0.0" });
    await client.connect(transport);
    cleanup.push(async () => {
      await client.close();
    });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([...LIVE_TOOLS]);

    const status = await client.callTool({
      name: "conviction_account_status",
      arguments: {},
    });
    expect(status.structuredContent).toMatchObject({
      ok: true,
      mode: "live",
      handle: "signal-scout",
      fundingReady: true,
    });
    expect(status.structuredContent).not.toHaveProperty("funded");
    expect(api.leases.size).toBe(1);
    expect(stderr).toContain("live server ready on stdio");
    expect(JSON.stringify(listed.tools)).not.toMatch(
      /signMessage|privateKey|mnemonic|authorize/i,
    );
  });

  it("rejects a second concurrent process with actionable lease conflict details", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "conviction-live-conflict-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));

    const unlockSecret = "machine-unlock-secret";
    const generated = await generateEncryptedKeystore(unlockSecret);
    const paths = resolveConvictionPaths(home);
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
      actionPolicy: { trade: true, back: true, publish: false },
      maxTradeUsd: 25,
      spendBudgetUsd: 100,
      createdAt: "2026-07-17T12:00:00.000Z",
    });

    const api = await startMockApi(generated.address);

    const firstTransport = new StdioClientTransport({
      command: process.execPath,
      args: [
        executable,
        "serve",
        "--profile",
        profileName,
        "--home",
        home,
        "--api-base",
        api.apiBaseUrl,
      ],
      cwd: packageRoot,
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "",
        CONVICTION_KEYSTORE_PASSWORD: unlockSecret,
      },
      stderr: "pipe",
    });
    const first = new Client({ name: "live-first", version: "1.0.0" });
    await first.connect(firstTransport);
    cleanup.push(async () => {
      await first.close();
    });

    const secondTransport = new StdioClientTransport({
      command: process.execPath,
      args: [
        executable,
        "serve",
        "--profile",
        profileName,
        "--home",
        home,
        "--api-base",
        api.apiBaseUrl,
      ],
      cwd: packageRoot,
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "",
        CONVICTION_KEYSTORE_PASSWORD: unlockSecret,
      },
      stderr: "pipe",
    });

    let secondStderr = "";
    secondTransport.stderr?.on("data", (chunk: Buffer | string) => {
      secondStderr += chunk.toString();
    });

    await expect(
      (async () => {
        const second = new Client({ name: "live-second", version: "1.0.0" });
        await second.connect(secondTransport);
        await second.close();
      })(),
    ).rejects.toThrow();

    expect(secondStderr).toMatch(/lease conflict/i);
  });
});
