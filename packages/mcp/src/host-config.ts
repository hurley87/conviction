import {
  PACKAGE_MAJOR_PIN,
  hostById,
  type SupportedHostId,
} from "./setup-contract.js";

export type HostConfigSnippet = {
  hostId: SupportedHostId;
  label: string;
  description: string;
  /** Primary copyable command or file fragment. */
  primary: string;
  /** Optional secondary fragment (for example Codex config.toml). */
  secondary?: {
    label: string;
    content: string;
  };
};

export type HostConfigOptions = {
  profileName: string;
};

const SECRET_PATTERN =
  /(?:--code\b|CONVICTION_BACKUP_PASSPHRASE|CONVICTION_KEYSTORE_PASSWORD|CONVICTION_PRIVATE_KEY|0x[a-fA-F0-9]{64}|backup-passphrase)/i;

function assertSafeSnippet(content: string, label: string): void {
  if (SECRET_PATTERN.test(content)) {
    throw new Error(
      `Refusing to generate ${label}: host configuration must never embed secrets or provisioning codes.`,
    );
  }
  if (!content.includes(PACKAGE_MAJOR_PIN)) {
    throw new Error(
      `Refusing to generate ${label}: package-runner configs must pin ${PACKAGE_MAJOR_PIN}.`,
    );
  }
}

function packageRunnerArgs(profileName: string): string[] {
  return ["-y", PACKAGE_MAJOR_PIN, "serve", "--profile", profileName];
}

function formatShellCommand(bin: string, profileName: string): string {
  const args = packageRunnerArgs(profileName)
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
  return `${bin} mcp add conviction -- npx ${args}`;
}

function formatToml(profileName: string): string {
  const args = packageRunnerArgs(profileName)
    .map((part) => JSON.stringify(part))
    .join(", ");
  return [
    "[mcp_servers.conviction]",
    'command = "npx"',
    `args = [${args}]`,
  ].join("\n");
}

function formatHermesYaml(profileName: string): string {
  const args = packageRunnerArgs(profileName)
    .map((part) => `      - ${JSON.stringify(part)}`)
    .join("\n");
  return [
    "# Add under mcp_servers in ~/.hermes/config.yaml",
    "mcp_servers:",
    "  conviction:",
    '    command: "npx"',
    "    args:",
    args,
  ].join("\n");
}

function snippetFor(
  hostId: SupportedHostId,
  primary: string,
  secondary?: HostConfigSnippet["secondary"],
): HostConfigSnippet {
  const host = hostById[hostId];
  return {
    hostId,
    label: host.label,
    description: host.connectionMethod,
    primary,
    ...(secondary ? { secondary } : {}),
  };
}

/** Generate major-pinned host configs that never embed secrets or one-time codes. */
export function generateHostConfigs(
  options: HostConfigOptions,
): HostConfigSnippet[] {
  const profileName = options.profileName.trim();
  if (!profileName) {
    throw new Error("profileName is required to generate host configuration.");
  }

  const snippets: HostConfigSnippet[] = [
    snippetFor("claude-code", formatShellCommand("claude", profileName)),
    snippetFor("codex", formatShellCommand("codex", profileName), {
      label: "~/.codex/config.toml",
      content: formatToml(profileName),
    }),
    snippetFor("hermes", formatHermesYaml(profileName)),
    snippetFor("openclaw", formatShellCommand("openclaw", profileName)),
  ];

  for (const snippet of snippets) {
    assertSafeSnippet(snippet.primary, snippet.label);
    if (snippet.secondary) {
      assertSafeSnippet(snippet.secondary.content, snippet.secondary.label);
    }
  }

  return snippets;
}

/** Human-readable block printed by init/doctor and mirrored in Agent Access. */
export function formatHostConfigGuide(options: HostConfigOptions): string {
  const snippets = generateHostConfigs(options);
  const lines = [
    "Shared MCP contract: every host below launches the same tool surface.",
    `Package pin: ${PACKAGE_MAJOR_PIN}`,
    "",
  ];

  for (const snippet of snippets) {
    lines.push(`## ${snippet.label}`);
    lines.push(snippet.description);
    lines.push("");
    lines.push(snippet.primary);
    if (snippet.secondary) {
      lines.push("");
      lines.push(`# ${snippet.secondary.label}`);
      lines.push(snippet.secondary.content);
    }
    lines.push("");
  }

  lines.push("Platforms: macOS and Linux are supported. Windows is supported through WSL.");
  lines.push("Native Windows is deferred.");
  return lines.join("\n").trimEnd();
}
