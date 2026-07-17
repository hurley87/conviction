import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runInit, describeInitUnlockHint } from "./init.js";
import { createMockServer } from "./mock-server.js";
import {
  createDefaultUnlockSecretStore,
  KEYSTORE_PASSWORD_ENV,
  MemoryUnlockSecretStore,
} from "./unlock-secret.js";

const HELP = `Conviction MCP

Usage:
  conviction-mcp serve --mock
  conviction-mcp init --code <one-time-code> --backup-path <file> [options]
  conviction-mcp help

Commands:
  serve --mock   Start the deterministic mock server over stdio
  init           Redeem a provisioning handoff into a local encrypted profile
  help           Show this help

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
  CONVICTION_API_BASE            Default API base URL for init

Mock mode uses no account, credentials, signer, or signing material.
Init generates the signer locally and never accepts a raw private key.`;

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

export async function runCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === "help" || args.includes("--help")) {
    console.log(HELP);
    return;
  }

  if (args[0] === "init") {
    await runInitCommand(args.slice(1));
    return;
  }

  if (args.length !== 2 || args[0] !== "serve" || args[1] !== "--mock") {
    throw new Error(
      "unsupported command; use `conviction-mcp serve --mock`, `conviction-mcp init --code …`, or `conviction-mcp help`",
    );
  }

  const server = createMockServer();
  const transport = new StdioServerTransport();

  // stdout is reserved for MCP protocol frames. Diagnostics belong on stderr.
  console.error("Conviction MCP mock server ready on stdio");
  await server.connect(transport);
}
