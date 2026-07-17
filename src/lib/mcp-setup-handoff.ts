import {
  PACKAGE_MAJOR_PIN,
  SETUP_CONTRACT_VERSION,
} from "@conviction/mcp/setup-contract";

/** Short paste-to-agent prompt that points at the public skill page. */
export function buildAgentSetupHandoffPrompt(options: {
  skillUrl: string;
  profileName?: string;
}): string {
  const profileLine = options.profileName
    ? `Default local profile name (unless the operator used a custom --profile): ${options.profileName}`
    : "Ask the operator for the local profile name after init.";

  return [
    "You are helping set up Conviction MCP for an operator.",
    "",
    `Read the setup skill first: ${options.skillUrl}`,
    `Setup contract version: ${SETUP_CONTRACT_VERSION}`,
    `Package pin: ${PACKAGE_MAJOR_PIN}`,
    profileLine,
    "",
    "Follow the skill exactly.",
    "Do not provision, redeem, fund, change policy, disable, enable, retire, or access secrets.",
    "When operator action is required (Agent Access, init code, doctor, funding), ask the human to do it.",
  ].join("\n");
}

/** Strip YAML frontmatter for human-readable page rendering. */
export function skillBodyMarkdown(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) return raw;
  return raw.slice(end + 5).trimStart();
}
