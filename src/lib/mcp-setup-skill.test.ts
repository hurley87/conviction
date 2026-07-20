import { describe, expect, it } from "vitest";

import {
  buildAgentSetupHandoffPrompt,
  skillBodyMarkdown,
} from "@/lib/mcp-setup-handoff";
import { loadMcpSetupSkillMarkdown } from "@/lib/mcp-setup-skill";

describe("mcp setup skill helpers", () => {
  it("loads the package skill and strips frontmatter", async () => {
    const raw = await loadMcpSetupSkillMarkdown();
    expect(raw).toContain("name: conviction-mcp-setup");
    expect(skillBodyMarkdown(raw)).toContain("# Conviction MCP setup");
    expect(skillBodyMarkdown(raw)).not.toContain("name: conviction-mcp-setup");
  });

  it("builds a bounded agent handoff prompt", () => {
    const prompt = buildAgentSetupHandoffPrompt({
      skillUrl: "http://localhost:3000/agent-access/skill",
      profileName: "signal-scout",
    });
    expect(prompt).toContain("http://localhost:3000/agent-access/skill");
    expect(prompt).toContain("@getconviction/mcp@2");
    expect(prompt).toContain("signal-scout");
    expect(prompt).toMatch(/Do not provision/i);
    expect(prompt).not.toContain("--code");
  });
});
