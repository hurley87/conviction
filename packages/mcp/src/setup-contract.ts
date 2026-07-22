import { z } from "zod";

/** Versioned MCP setup contract shared by CLI, Agent Access, and the public skill. */
export const SETUP_CONTRACT_VERSION = 1 as const;

/** Package-runner pin for generated host configs (ADR 0046). */
export const PACKAGE_MAJOR_PIN = "@getconviction/mcp@2" as const;

/**
 * Operator-facing steps that map 1:1 to observable backend state.
 * Host configuration is content inside `verify`, not a separate progress step.
 */
export const SETUP_STEP_IDS = [
  "create",
  "provision",
  "backup",
  "verify",
  "fund",
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export const SUPPORTED_HOST_IDS = [
  "claude-code",
  "codex",
  "hermes",
  "openclaw",
] as const;

export type SupportedHostId = (typeof SUPPORTED_HOST_IDS)[number];

export const PLATFORM_IDS = ["macos", "linux", "windows-wsl", "windows-native"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

const setupStepSchema = z.object({
  id: z.enum(SETUP_STEP_IDS),
  title: z.string().min(1),
  summary: z.string().min(1),
  nextAction: z.string().min(1),
  operatorRequired: z.boolean(),
});

const hostSchema = z.object({
  id: z.enum(SUPPORTED_HOST_IDS),
  label: z.string().min(1),
  connectionMethod: z.string().min(1),
});

const platformSchema = z.object({
  id: z.enum(PLATFORM_IDS),
  label: z.string().min(1),
  support: z.enum(["supported", "deferred"]),
  notes: z.string().min(1),
});

const skillBoundariesSchema = z.object({
  may: z.array(z.string().min(1)).min(1),
  mustNot: z.array(z.string().min(1)).min(1),
});

export const setupContractSchema = z.object({
  version: z.literal(SETUP_CONTRACT_VERSION),
  packageMajorPin: z.literal(PACKAGE_MAJOR_PIN),
  serveCommand: z.string().min(1),
  doctorCommand: z.string().min(1),
  statusCommand: z.string().min(1),
  steps: z.array(setupStepSchema).length(SETUP_STEP_IDS.length),
  hosts: z.array(hostSchema).length(SUPPORTED_HOST_IDS.length),
  platforms: z.array(platformSchema).length(PLATFORM_IDS.length),
  skillBoundaries: skillBoundariesSchema,
  sharedMcpContractNote: z.string().min(1),
});

export type SetupContract = z.infer<typeof setupContractSchema>;

export const SETUP_CONTRACT: SetupContract = setupContractSchema.parse({
  version: SETUP_CONTRACT_VERSION,
  packageMajorPin: PACKAGE_MAJOR_PIN,
  serveCommand: "conviction-mcp serve --profile <name>",
  doctorCommand: "conviction-mcp doctor --profile <name>",
  statusCommand: "conviction-mcp status --profile <name>",
  steps: [
    {
      id: "create",
      title: "Create agent",
      summary: "Reserve one pending agent identity and spending policy in Agent Access.",
      nextAction: "Create a pending agent in Agent Access.",
      operatorRequired: true,
    },
    {
      id: "provision",
      title: "Provision locally",
      summary:
        "Redeem the one-time handoff into an encrypted local signer profile (complete init command from Agent Access).",
      nextAction:
        "Paste and run the copyable conviction-mcp init command from Agent Access (prompts for a recovery passphrase).",
      operatorRequired: true,
    },
    {
      id: "backup",
      title: "Verify backup",
      summary: "Export and decrypt-verify the passphrase-encrypted signer backup.",
      nextAction: "Finish init so backup export and decrypt-verification succeed.",
      operatorRequired: true,
    },
    {
      id: "verify",
      title: "Verify locally",
      summary:
        "Successful init auto-runs doctor; paste a host config with the shared MCP contract. Re-run doctor only if verification did not complete.",
      nextAction:
        "Add a major-pinned host config from the init output, then fund after doctor records setup verification.",
      operatorRequired: true,
    },
    {
      id: "fund",
      title: "Fund account",
      summary: "Send funds to the Universal Account after local verification succeeds.",
      nextAction: "Send funds to the displayed deposit address.",
      operatorRequired: true,
    },
  ],
  hosts: [
    {
      id: "claude-code",
      label: "Claude Code",
      connectionMethod: "Local stdio server added with claude mcp add",
    },
    {
      id: "codex",
      label: "Codex",
      connectionMethod: "Local stdio server added with codex mcp add or config.toml",
    },
    {
      id: "hermes",
      label: "Hermes",
      connectionMethod: "Local stdio entry under mcp_servers in ~/.hermes/config.yaml",
    },
    {
      id: "openclaw",
      label: "OpenClaw",
      connectionMethod: "Local stdio entry added with openclaw mcp add",
    },
  ],
  platforms: [
    {
      id: "macos",
      label: "macOS",
      support: "supported",
      notes: "OS credential store via Keychain; package-runner host configs are supported.",
    },
    {
      id: "linux",
      label: "Linux",
      support: "supported",
      notes: "Desktop Secret Service when available; headless hosts may use CONVICTION_KEYSTORE_PASSWORD.",
    },
    {
      id: "windows-wsl",
      label: "Windows (WSL)",
      support: "supported",
      notes: "Supported Windows path in v1. Run setup inside WSL with a Linux Node.js install.",
    },
    {
      id: "windows-native",
      label: "Windows (native)",
      support: "deferred",
      notes: "Native Windows is deferred until keystore, process lifecycle, and host matrix verification land.",
    },
  ],
  skillBoundaries: {
    may: [
      "Explain installation and major-pinned package-runner usage",
      "Explain host configuration for the four supported clients",
      "Explain doctor and status diagnostics",
      "Explain that policy, disable, and enable are operator-only (Agent Settings or conviction-mcp disable|enable)",
      "Tell the operator when a human action is required in Agent Access or the local CLI",
    ],
    mustNot: [
      "Provision or redeem an agent",
      "Fund an account or move value",
      "Change policy, disable, enable, or retire an agent",
      "Read, print, request, or store signer secrets, unlock secrets, recovery passphrases, or one-time codes",
    ],
  },
  sharedMcpContractNote:
    "Claude Code, Codex, Hermes, and OpenClaw share one MCP tool contract. Host-specific content is configuration only.",
});

const stepById = Object.fromEntries(
  SETUP_CONTRACT.steps.map((step) => [step.id, step]),
) as Record<SetupStepId, SetupContract["steps"][number]>;

export const hostById = Object.fromEntries(
  SETUP_CONTRACT.hosts.map((host) => [host.id, host]),
) as Record<SupportedHostId, SetupContract["hosts"][number]>;

export function setupStep(id: SetupStepId) {
  return stepById[id];
}

/** Default local profile name derived from an agent handle (matches init). */
export function defaultProfileName(handle: string): string {
  return handle.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

export type SetupAgentSnapshot = {
  status: string;
  fundingReady: boolean;
  setupVerifiedAt: string | null;
};

export type SetupPhaseKind =
  | "create"
  | "provision"
  | "backup"
  | "verify"
  | "fund"
  | "terminal";

/** Single view-model for progress rail + action panels. */
export type SetupPhase = {
  kind: SetupPhaseKind;
  currentStep: SetupStepId | null;
  completedStepIds: SetupStepId[];
  nextAction: string;
  suggestFunding: boolean;
};

function phase(
  kind: SetupPhaseKind,
  currentStep: SetupStepId | null,
  completedStepIds: SetupStepId[],
  nextAction: string,
  suggestFunding = false,
): SetupPhase {
  return { kind, currentStep, completedStepIds, nextAction, suggestFunding };
}

const TERMINAL_STATUSES = new Set([
  "disabled",
  "capped",
  "retiring",
  "retired",
]);

/** Derive one setup phase from backend-authoritative agent state. */
export function resolveSetupPhase(
  agent: SetupAgentSnapshot | null,
): SetupPhase {
  if (!agent) {
    return phase("create", "create", [], setupStep("create").nextAction);
  }

  if (TERMINAL_STATUSES.has(agent.status)) {
    return phase(
      "terminal",
      null,
      [],
      `This agent is ${agent.status}. Retire or resolve that lifecycle state before continuing setup.`,
    );
  }

  if (agent.status === "provisioning") {
    return phase("provision", "provision", ["create"], setupStep("provision").nextAction);
  }

  if (!agent.fundingReady) {
    return phase(
      "backup",
      "backup",
      ["create", "provision"],
      setupStep("backup").nextAction,
    );
  }

  if (!agent.setupVerifiedAt) {
    return phase(
      "verify",
      "verify",
      ["create", "provision", "backup"],
      setupStep("verify").nextAction,
    );
  }

  return phase(
    "fund",
    "fund",
    ["create", "provision", "backup", "verify"],
    setupStep("fund").nextAction,
    true,
  );
}

/** @deprecated Prefer resolveSetupPhase — kept for call-site migration. */
export function resolveSetupProgress(agent: SetupAgentSnapshot | null) {
  const resolved = resolveSetupPhase(agent);
  return {
    contractVersion: SETUP_CONTRACT_VERSION,
    currentStep: resolved.currentStep ?? "create",
    completedStepIds: resolved.completedStepIds,
    nextAction: resolved.nextAction,
    suggestFunding: resolved.suggestFunding,
  };
}

export function assertSetupContract(value: unknown): SetupContract {
  return setupContractSchema.parse(value);
}
