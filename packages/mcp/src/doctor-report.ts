import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LiveAgentStatus } from "./live-api-client.js";
import {
  PACKAGE_MAJOR_PIN,
  SETUP_CONTRACT,
  SETUP_CONTRACT_VERSION,
} from "./setup-contract.js";
import { KEYSTORE_PASSWORD_ENV } from "./unlock-secret.js";

export type DoctorReportInput = {
  ok: boolean;
  profileName: string;
  checks: Array<{
    id: string;
    title: string;
    status: string;
    detail: string;
  }>;
  status: LiveAgentStatus | null;
  suggestFunding: boolean;
};

function redactAddress(address: string): string {
  if (address.length < 12) return "[redacted]";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function assertReportHasNoSecrets(serialized: string): void {
  const banned = [
    "CONVICTION_BACKUP_PASSPHRASE=",
    "CONVICTION_KEYSTORE_PASSWORD=",
    "CONVICTION_PRIVATE_KEY=",
    "--code ",
  ];
  for (const token of banned) {
    if (serialized.includes(token)) {
      throw new Error("Doctor report contained a forbidden secret pattern.");
    }
  }
}

/** Write a redacted local support bundle (never uploads). */
export async function writeDoctorReport(
  reportPath: string,
  result: DoctorReportInput,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const absolute = path.resolve(reportPath);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });

  const redactedStatus = result.status
    ? {
        ...result.status,
        address: redactAddress(result.status.address),
        depositAddress: redactAddress(result.status.depositAddress),
      }
    : null;

  const bundle = {
    manifest: {
      version: SETUP_CONTRACT_VERSION,
      packageMajorPin: PACKAGE_MAJOR_PIN,
      generatedAt: new Date().toISOString(),
      redactions: [
        "private keys",
        "keystore passwords",
        "recovery passphrases",
        "credential-store values",
        "provisioning codes",
        "signed payloads",
        "full addresses where unnecessary",
        "environment-variable values",
        "host prompts and MCP conversations",
      ],
      included: [
        "package and runtime versions",
        "operating-system family",
        "doctor check results",
        "redacted account status",
        "setup contract version",
      ],
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      packageMajorPin: PACKAGE_MAJOR_PIN,
      setupContractVersion: SETUP_CONTRACT_VERSION,
      envKeysPresent: {
        [KEYSTORE_PASSWORD_ENV]: Boolean(env[KEYSTORE_PASSWORD_ENV]?.trim()),
        CONVICTION_API_BASE: Boolean(env.CONVICTION_API_BASE?.trim()),
      },
    },
    doctor: {
      ok: result.ok,
      profileName: result.profileName,
      checks: result.checks,
      status: redactedStatus,
      suggestFunding: result.suggestFunding,
    },
    contract: {
      version: SETUP_CONTRACT.version,
      hosts: SETUP_CONTRACT.hosts.map((host) => host.id),
      platforms: SETUP_CONTRACT.platforms.map((platform) => ({
        id: platform.id,
        support: platform.support,
      })),
    },
  };

  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  assertReportHasNoSecrets(serialized);
  await writeFile(absolute, serialized, { encoding: "utf8", mode: 0o600 });
  await chmod(absolute, 0o600);
}
