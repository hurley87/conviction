import type { Metadata } from "next";
import { headers } from "next/headers";
import { SetupSkillViewer } from "@/components/agent-access/setup-skill-viewer";
import { loadMcpSetupSkillMarkdown } from "@/lib/mcp-setup-skill";

export const metadata: Metadata = {
  title: "MCP setup skill | Conviction",
  description:
    "Public Agent Skills guide for installing and configuring Conviction MCP.",
};

async function resolveSkillUrl(): Promise<string> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  if (!host) return "/agent-access/skill";
  return `${proto}://${host}/agent-access/skill`;
}

export default async function AgentAccessSkillPage() {
  const [skillMarkdown, skillUrl] = await Promise.all([
    loadMcpSetupSkillMarkdown(),
    resolveSkillUrl(),
  ]);

  return (
    <SetupSkillViewer skillMarkdown={skillMarkdown} skillUrl={skillUrl} />
  );
}
