import { z } from "zod";

/** Versioned MCP setup contract shared by CLI, Agent Access, and the public skill. */
export const SETUP_CONTRACT_VERSION = 1 as const;

/** Package-runner pin for generated host configs (ADR 0046). */
export const PACKAGE_MAJOR_PIN = "@conviction/mcp@1" as const;

export const SETUP_STEP_IDS = [
  "create",
  "provision",
  "backup",
  "connect",
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
      summary: "Redeem the one-time handoff into an encrypted local signer profile.",
      nextAction: "Run the one-time conviction-mcp init command from Agent Access.",
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
      id: "connect",
      title: "Configure host",
      summary: "Add the shared MCP server to Claude Code, Codex, Hermes, or OpenClaw.",
      nextAction: "Copy a major-pinned host configuration and add it to your MCP host.",
      operatorRequired: true,
    },
    {
      id: "verify",
      title: "Verify connection",
      summary: "Run a non-value-moving doctor check before sending funds.",
      nextAction: "Run conviction-mcp doctor --profile <name> and confirm success.",
      operatorRequired: true,
    },
    {
      id: "fund",
      title: "Fund account",
      summary: "Send funds to the Universal Account after connection verification succeeds.",
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

export type SetupAgentSnapshot = {
  status: string;
  fundingReady: boolean;
  setupVerifiedAt: string | null;
};

export type SetupProgress = {
  contractVersion: typeof SETUP_CONTRACT_VERSION;
  currentStep: SetupStepId;
  completedStepIds: SetupStepId[];
  nextAction: string;
  suggestFunding: boolean;
};

/** Derive setup progress from backend-authoritative agent state. */
export function resolveSetupProgress(
  agent: SetupAgentSnapshot | null,
): SetupProgress {
  if (!agent) {
    return {
      contractVersion: SETUP_CONTRACT_VERSION,
      currentStep: "create",
      completedStepIds: [],
      nextAction: SETUP_CONTRACT.steps[0]!.nextAction,
      suggestFunding: false,
    };
  }

  if (agent.status === "provisioning") {
    return {
      contractVersion: SETUP_CONTRACT_VERSION,
      currentStep: "provision",
      completedStepIds: ["create"],
      nextAction: SETUP_CONTRACT.steps[1]!.nextAction,
      suggestFunding: false,
    };
  }

  if (!agent.fundingReady) {
    return {
      contractVersion: SETUP_CONTRACT_VERSION,
      currentStep: "backup",
      completedStepIds: ["create", "provision"],
      nextAction: SETUP_CONTRACT.steps[2]!.nextAction,
      suggestFunding: false,
    };
  }

  if (!agent.setupVerifiedAt) {
    return {
      contractVersion: SETUP_CONTRACT_VERSION,
      currentStep: "connect",
      completedStepIds: ["create", "provision", "backup"],
      nextAction:
        "Configure an MCP host, then run conviction-mcp doctor --profile <name>.",
      suggestFunding: false,
    };
  }

  return {
    contractVersion: SETUP_CONTRACT_VERSION,
    currentStep: "fund",
    completedStepIds: ["create", "provision", "backup", "connect", "verify"],
    nextAction: SETUP_CONTRACT.steps[5]!.nextAction,
    suggestFunding: true,
  };
}

export function assertSetupContract(value: unknown): SetupContract {
  return setupContractSchema.parse(value);
}
