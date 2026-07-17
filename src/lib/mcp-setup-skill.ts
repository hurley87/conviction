import { readFile } from "node:fs/promises";
import path from "node:path";

const SKILL_RELATIVE = path.join(
  "skills",
  "conviction-mcp-setup",
  "SKILL.md",
);

/** Load the public Agent Skills setup guide shipped with @conviction/mcp. */
export async function loadMcpSetupSkillMarkdown(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), "packages", "mcp", SKILL_RELATIVE),
    path.join(process.cwd(), "node_modules", "@conviction", "mcp", SKILL_RELATIVE),
  ];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try next path
    }
  }

  throw new Error(
    "Could not load packages/mcp/skills/conviction-mcp-setup/SKILL.md",
  );
}
