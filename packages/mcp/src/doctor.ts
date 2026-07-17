import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

import { ConvictionApiError } from "./api-client.js";
import { formatHostConfigGuide } from "./host-config.js";
import { loadWalletFromKeystore } from "./keystore.js";
import {
  fetchAgentStatus,
  markSetupVerified,
  type LiveAgentStatus,
} from "./live-api-client.js";
import { LIVE_TOOLS } from "./live-server.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile, type AgentProfile } from "./profile.js";
import {
  PACKAGE_MAJOR_PIN,
  SETUP_CONTRACT,
  SETUP_CONTRACT_VERSION,
} from "./setup-contract.js";
import {
  createDefaultUnlockSecretStore,
  KEYSTORE_PASSWORD_ENV,
  MemoryUnlockSecretStore,
  requireUnlockSecret,
  type UnlockSecretStore,
} from "./unlock-secret.js";

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export type DoctorCheck = {
  id: string;
  title: string;
  status: DoctorCheckStatus;
  detail: string;
};

export type DoctorResult = {
  ok: boolean;
  profileName: string;
  checks: DoctorCheck[];
  status: LiveAgentStatus | null;
  depositAddress: string | null;
  suggestFunding: boolean;
  hostConfigGuide: string | null;
};

export type DoctorOptions = {
  profileName: string;
  apiBaseUrl: string;
  home?: string;
  reportPath?: string;
  unlockStore?: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Skip backend mark when testing pure local diagnostics. */
  recordSetupVerification?: boolean;
};

function check(
  id: string,
  title: string,
  status: DoctorCheckStatus,
  detail: string,
): DoctorCheck {
  return { id, title, status, detail };
}

async function resolveUnlockStore(
  env: NodeJS.ProcessEnv,
  provided?: UnlockSecretStore,
): Promise<{ store: UnlockSecretStore; source: string }> {
  if (provided) {
    return { store: provided, source: "provided" };
  }
  if (env[KEYSTORE_PASSWORD_ENV]?.trim()) {
    return {
      store: new MemoryUnlockSecretStore(),
      source: KEYSTORE_PASSWORD_ENV,
    };
  }
  return {
    store: await createDefaultUnlockSecretStore(),
    source: "os-credential-store",
  };
}

/** Non-value-moving diagnostics for a provisioned profile. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const env = options.env ?? process.env;
  const checks: DoctorCheck[] = [];
  const paths = resolveConvictionPaths(options.home);
  const filePath = profilePath(paths, options.profileName);

  let profile: AgentProfile;
  try {
    profile = await readAgentProfile(filePath);
    checks.push(
      check(
        "profile",
        "Profile integrity",
        "pass",
        `Readable profile for @${profile.handle} (${profile.agentId}).`,
      ),
    );
  } catch (error) {
    checks.push(
      check(
        "profile",
        "Profile integrity",
        "fail",
        error instanceof Error ? error.message : "Profile could not be read.",
      ),
    );
    return {
      ok: false,
      profileName: options.profileName,
      checks,
      status: null,
      depositAddress: null,
      suggestFunding: false,
      hostConfigGuide: null,
    };
  }

  const { store, source } = await resolveUnlockStore(env, options.unlockStore);
  checks.push(
    check(
      "credential_store",
      "Credential store",
      "pass",
      `Unlock secret source: ${source}. Secrets are never printed.`,
    ),
  );

  let wallet;
  try {
    const unlockSecret = requireUnlockSecret({
      signerAddress: profile.signerAddress,
      store,
      env,
    });
    wallet = await loadWalletFromKeystore(profile.keystorePath, unlockSecret);
    if (wallet.address.toLowerCase() !== profile.signerAddress.toLowerCase()) {
      throw new Error(
        "Local profile signer address does not match the encrypted keystore.",
      );
    }
    checks.push(
      check(
        "keystore",
        "Keystore access",
        "pass",
        "Encrypted keystore unlocked and public address matches the profile.",
      ),
    );
  } catch (error) {
    checks.push(
      check(
        "keystore",
        "Keystore access",
        "fail",
        error instanceof Error ? error.message : "Keystore unlock failed.",
      ),
    );
    return {
      ok: false,
      profileName: profile.profileName,
      checks,
      status: null,
      depositAddress: null,
      suggestFunding: false,
      hostConfigGuide: formatHostConfigGuide({
        profileName: profile.profileName,
      }),
    };
  }

  checks.push(
    check(
      "tool_discovery",
      "Tool discovery",
      LIVE_TOOLS.length === 10 ? "pass" : "fail",
      `Canonical v1 contract exposes ${LIVE_TOOLS.length} tools locally without moving funds.`,
    ),
  );

  checks.push(
    check(
      "particle",
      "Particle configuration",
      "warn",
      "Particle execution paths are exercised by quote/execute tools after funding; doctor does not call them.",
    ),
  );

  let status: LiveAgentStatus | null = null;
  try {
    status = await fetchAgentStatus({
      apiBaseUrl: options.apiBaseUrl,
      wallet,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    checks.push(
      check(
        "backend_auth",
        "Backend authentication",
        "pass",
        `Authenticated as @${status.handle} (${status.status}, fundingReady=${String(status.fundingReady)}).`,
      ),
    );
    checks.push(
      check(
        "account_status",
        "Account status",
        "pass",
        `Policy trade=${String(status.actionPolicy.trade)} back=${String(status.actionPolicy.back)} publish=${String(status.actionPolicy.publish)}; remaining budget $${status.remainingBudgetUsd}.`,
      ),
    );
  } catch (error) {
    const detail =
      error instanceof ConvictionApiError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Backend status check failed.";
    checks.push(
      check("backend_auth", "Backend authentication", "fail", detail),
    );
  }

  const failed = checks.some((entry) => entry.status === "fail");
  let suggestFunding = false;
  let depositAddress = status?.depositAddress ?? profile.universalAccountAddress;

  if (!failed && status?.fundingReady && options.recordSetupVerification !== false) {
    try {
      const verified = await markSetupVerified({
        apiBaseUrl: options.apiBaseUrl,
        wallet,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      status = verified;
      suggestFunding = true;
      depositAddress = verified.depositAddress;
      checks.push(
        check(
          "setup_verification",
          "Setup verification",
          "pass",
          `Connection verified at ${verified.setupVerifiedAt ?? "now"}. Funding may be suggested.`,
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "setup_verification",
          "Setup verification",
          "fail",
          error instanceof Error
            ? error.message
            : "Could not record setup verification.",
        ),
      );
    }
  }

  const ok = !checks.some((entry) => entry.status === "fail");
  const result: DoctorResult = {
    ok,
    profileName: profile.profileName,
    checks,
    status,
    depositAddress: ok ? depositAddress : null,
    suggestFunding: ok && suggestFunding,
    hostConfigGuide: formatHostConfigGuide({
      profileName: profile.profileName,
    }),
  };

  if (options.reportPath) {
    await writeDoctorReport(options.reportPath, result, env);
  }

  return result;
}

async function writeDoctorReport(
  reportPath: string,
  result: DoctorResult,
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

export function formatDoctorOutput(result: DoctorResult): string {
  const lines = [
    `Conviction MCP doctor (setup contract v${SETUP_CONTRACT_VERSION})`,
    `Profile: ${result.profileName}`,
    "",
  ];

  for (const entry of result.checks) {
    const mark =
      entry.status === "pass" ? "PASS" : entry.status === "warn" ? "WARN" : "FAIL";
    lines.push(`[${mark}] ${entry.title}: ${entry.detail}`);
  }

  lines.push("");
  if (!result.ok) {
    lines.push("Doctor failed. Fix the failing checks before funding the account.");
    return lines.join("\n");
  }

  lines.push("Connection check succeeded. No funds were moved.");
  if (result.suggestFunding && result.depositAddress) {
    lines.push("");
    lines.push("Next: fund the Universal Account.");
    lines.push(`Deposit address: ${result.depositAddress}`);
  } else if (result.hostConfigGuide) {
    lines.push("");
    lines.push("If a host is not configured yet:");
    lines.push(result.hostConfigGuide);
  }
  return lines.join("\n");
}

export type StatusOptions = {
  profileName: string;
  apiBaseUrl: string;
  home?: string;
  unlockStore?: UnlockSecretStore;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
};

export async function runStatus(options: StatusOptions): Promise<LiveAgentStatus> {
  const env = options.env ?? process.env;
  const paths = resolveConvictionPaths(options.home);
  const profile = await readAgentProfile(
    profilePath(paths, options.profileName),
  );
  const { store } = await resolveUnlockStore(env, options.unlockStore);
  const unlockSecret = requireUnlockSecret({
    signerAddress: profile.signerAddress,
    store,
    env,
  });
  const wallet = await loadWalletFromKeystore(profile.keystorePath, unlockSecret);
  return fetchAgentStatus({
    apiBaseUrl: options.apiBaseUrl,
    wallet,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}

export function formatStatusOutput(status: LiveAgentStatus): string {
  return inspect(
    {
      handle: status.handle,
      agentId: status.agentId,
      status: status.status,
      publicStatus: status.publicStatus,
      fundingReady: status.fundingReady,
      setupVerifiedAt: status.setupVerifiedAt ?? null,
      depositAddress: status.depositAddress,
      remainingBudgetUsd: status.remainingBudgetUsd,
      actionPolicy: status.actionPolicy,
    },
    { colors: false, depth: 3, compact: false },
  );
}
