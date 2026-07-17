import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConvictionApiError } from "./api-client.js";
import { runInit, describeInitUnlockHint } from "./init.js";
import { loadWalletFromKeystore } from "./keystore.js";
import { acquireLeaseHandle } from "./lease.js";
import { createLiveServer } from "./live-server.js";
import { createMockServer } from "./mock-server.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile } from "./profile.js";
import {
  createDefaultUnlockSecretStore,
  KEYSTORE_PASSWORD_ENV,
  MemoryUnlockSecretStore,
  requireUnlockSecret,
} from "./unlock-secret.js";

const HELP = `Conviction MCP

Usage:
  conviction-mcp serve --mock
  conviction-mcp serve --profile <name> [options]
  conviction-mcp init --code <one-time-code> --backup-path <file> [options]
  conviction-mcp help

Commands:
  serve --mock               Start the deterministic mock server over stdio
  serve --profile <name>     Start the live server for a provisioned profile
  init                       Redeem a provisioning handoff into a local encrypted profile
  help                       Show this help

Serve --profile options:
  --profile <name>           Local profile name (required)
  --api-base <url>           Conviction API base URL
  --home <dir>               Override ~/.conviction (also CONVICTION_HOME)
  --replace-lease            Explicitly replace an existing MCP lease

Init options:
  --code <value>                 One-time provisioning code from Agent Access
  --backup-path <file>           Destination for the passphrase-encrypted backup
  --backup-passphrase <value>    Recovery passphrase (prefer env in scripts)
  --api-base <url>               Conviction API base URL
  --profile <name>               Local profile name (defaults to agent handle)
  --home <dir>                   Override ~/.conviction (also CONVICTION_HOME)

Environment:
  CONVICTION_BACKUP_PASSPHRASE   Recovery passphrase for the exported backup
  ${KEYSTORE_PASSWORD_ENV}       Headless keystore unlock secret
  CONVICTION_API_BASE            Default API base URL for init and serve

Mock mode uses no account, credentials, signer, or signing material.
Live mode authenticates with the local signer and never exposes signing tools.`;

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function requireFlag(args: string[], name: string, label: string): string {
  const value = readFlag(args, name)?.trim();
  if (!value) {
    throw new Error(`missing ${label}; see \`conviction-mcp help\``);
  }
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function runInitCommand(args: string[]): Promise<void> {
  const code = requireFlag(args, "--code", "--code");
  const backupPath = requireFlag(args, "--backup-path", "--backup-path");
  const recoveryPassphrase =
    readFlag(args, "--backup-passphrase")?.trim() ||
    process.env.CONVICTION_BACKUP_PASSPHRASE?.trim();
  if (!recoveryPassphrase) {
    throw new Error(
      "missing recovery passphrase; pass --backup-passphrase or set CONVICTION_BACKUP_PASSPHRASE",
    );
  }

  const apiBaseUrl =
    readFlag(args, "--api-base")?.trim() ||
    process.env.CONVICTION_API_BASE?.trim() ||
    "http://127.0.0.1:3000";
  const profileName = readFlag(args, "--profile")?.trim();
  const home = readFlag(args, "--home")?.trim();

  const unlockStore = process.env[KEYSTORE_PASSWORD_ENV]?.trim()
    ? new MemoryUnlockSecretStore()
    : await createDefaultUnlockSecretStore();

  console.error("Conviction MCP init: generating or resuming local signer…");
  console.error(describeInitUnlockHint());

  const result = await runInit({
    code,
    backupPath,
    recoveryPassphrase,
    apiBaseUrl,
    ...(profileName ? { profileName } : {}),
    ...(home ? { home } : {}),
    unlockStore,
  });

  console.error(`Profile written: ${result.profilePath}`);
  console.error(`Backup verified: ${result.backupPath}`);
  console.error(`Agent @${result.profile.handle} is ready for funding.`);
  console.error(`Deposit address: ${result.depositAddress}`);
  console.error(
    "Next: connect an MCP host with this profile, then fund the Universal Account.",
  );
}

async function runLiveServe(args: string[]): Promise<void> {
  const profileName = requireFlag(args, "--profile", "--profile");
  const apiBaseUrl =
    readFlag(args, "--api-base")?.trim() ||
    process.env.CONVICTION_API_BASE?.trim() ||
    "http://127.0.0.1:3000";
  const home = readFlag(args, "--home")?.trim();
  const replaceLease = hasFlag(args, "--replace-lease");

  const paths = resolveConvictionPaths(home);
  const profile = await readAgentProfile(profilePath(paths, profileName));

  const unlockStore = process.env[KEYSTORE_PASSWORD_ENV]?.trim()
    ? new MemoryUnlockSecretStore()
    : await createDefaultUnlockSecretStore();
  const unlockSecret = requireUnlockSecret({
    signerAddress: profile.signerAddress,
    store: unlockStore,
  });
  const wallet = await loadWalletFromKeystore(
    profile.keystorePath,
    unlockSecret,
  );

  if (wallet.address.toLowerCase() !== profile.signerAddress.toLowerCase()) {
    throw new Error(
      "Local profile signer address does not match the encrypted keystore.",
    );
  }

  console.error(
    `Conviction MCP: acquiring lease for @${profile.handle} (${profile.agentId})…`,
  );

  let lease;
  try {
    lease = await acquireLeaseHandle({
      apiBaseUrl,
      wallet,
      replace: replaceLease,
    });
  } catch (error) {
    if (error instanceof ConvictionApiError && error.code === "lease_conflict") {
      const details = error as ConvictionApiError & {
        activeLeaseExpiresAt?: string;
        leaseAgeMs?: number;
      };
      const age =
        typeof details.leaseAgeMs === "number"
          ? `${Math.round(details.leaseAgeMs / 1000)}s old`
          : "active";
      throw new Error(
        `MCP lease conflict (${age}${details.activeLeaseExpiresAt ? `, expires ${details.activeLeaseExpiresAt}` : ""}). Wait for expiry or rerun with --replace-lease.`,
      );
    }
    throw error;
  }

  const server = createLiveServer({
    profile,
    wallet,
    lease,
    apiBaseUrl,
  });
  const transport = new StdioServerTransport();

  const shutdown = async (reason: string) => {
    console.error(`Conviction MCP: ${reason}`);
    lease.stopHeartbeat();
    try {
      await server.close();
    } catch {
      // ignore close races
    }
    await lease.release();
    process.exitCode = 1;
    process.exit(1);
  };

  lease.onLost((lostReason, error) => {
    void shutdown(
      `lease lost (${lostReason})${error ? `: ${error.message}` : ""}`,
    );
  });

  const onSignal = () => {
    void (async () => {
      lease.stopHeartbeat();
      await lease.release();
      try {
        await server.close();
      } catch {
        // ignore
      }
      process.exit(0);
    })();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  lease.startHeartbeat();
  console.error(
    `Conviction MCP live server ready on stdio (lease ${lease.leaseId})`,
  );
  await server.connect(transport);
}

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args.includes("--help")) {
    console.log(HELP);
    return;
  }

  if (args[0] === "init") {
    await runInitCommand(args.slice(1));
    return;
  }

  if (args[0] === "serve") {
    const serveArgs = args.slice(1);
    if (serveArgs[0] === "--mock" && serveArgs.length === 1) {
      const server = createMockServer();
      const transport = new StdioServerTransport();
      console.error("Conviction MCP mock server ready on stdio");
      await server.connect(transport);
      return;
    }

    if (serveArgs.includes("--profile")) {
      await runLiveServe(serveArgs);
      return;
    }

    throw new Error(
      "unsupported serve mode; use `conviction-mcp serve --mock` or `conviction-mcp serve --profile <name>`",
    );
  }

  throw new Error(
    "unsupported command; use `conviction-mcp serve --mock`, `conviction-mcp serve --profile <name>`, `conviction-mcp init --code …`, or `conviction-mcp help`",
  );
}
