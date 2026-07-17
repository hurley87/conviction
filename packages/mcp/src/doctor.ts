import { ConvictionApiError } from "./api-client.js";
import { writeDoctorReport } from "./doctor-report.js";
import { formatHostConfigGuide } from "./host-config.js";
import { loadWalletFromKeystore } from "./keystore.js";
import {
  fetchAgentStatus,
  markSetupVerified,
  type LiveAgentStatus,
} from "./live-api-client.js";
import { profilePath, resolveConvictionPaths } from "./paths.js";
import { readAgentProfile, type AgentProfile } from "./profile.js";
import { SETUP_CONTRACT_VERSION } from "./setup-contract.js";
import {
  resolveUnlockStore,
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
  /**
   * When true (default), a successful doctor records setup verification on the backend.
   * This is an intentional mutating side effect of the connection check.
   */
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

function failedResult(
  profileName: string,
  checks: DoctorCheck[],
  hostConfigGuide: string | null = null,
): DoctorResult {
  return {
    ok: false,
    profileName,
    checks,
    status: null,
    depositAddress: null,
    suggestFunding: false,
    hostConfigGuide,
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
    return failedResult(options.profileName, checks);
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
    return failedResult(
      profile.profileName,
      checks,
      formatHostConfigGuide({ profileName: profile.profileName }),
    );
  }

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

  let suggestFunding = false;
  let depositAddress = status?.depositAddress ?? profile.universalAccountAddress;
  const shouldRecord = options.recordSetupVerification !== false;

  if (
    !checks.some((entry) => entry.status === "fail") &&
    status?.fundingReady &&
    shouldRecord
  ) {
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
          `Local verification recorded at ${verified.setupVerifiedAt}. Funding may be suggested.`,
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

  lines.push("Local verification succeeded. No funds were moved.");
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
