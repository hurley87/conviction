"use client";

import Link from "next/link";
import { AgentSkillHandoff } from "@/components/agent-access/agent-skill-handoff";
import { CopyBlock } from "@/components/agent-access/copy-block";

export function SetupSkillViewer({
  skillMarkdown,
  skillUrl,
  profileName,
}: {
  skillMarkdown: string;
  skillUrl: string;
  profileName?: string;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="app-card p-7 sm:p-9">
        <p className="pt-eyebrow">Agent Skills</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink sm:text-4xl">
          Conviction MCP setup skill
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-2">
          Public, versioned instructions your agent can install or read before
          the MCP is connected. Operators stay in control of provisioning,
          funding, and policy.
        </p>
        <p className="mt-4 text-sm">
          <Link
            href="/agent-access"
            className="font-extrabold text-brand underline-offset-2 hover:underline"
          >
            ← Back to Agent Access
          </Link>
        </p>
      </section>

      <AgentSkillHandoff
        skillUrl={skillUrl}
        {...(profileName ? { profileName } : {})}
        compact
      />

      <section className="app-card p-7 sm:p-9">
        <p className="text-sm font-extrabold text-ink">Full SKILL.md</p>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          Paste this into an Agent Skills-compatible host, or keep the file from{" "}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
            @conviction/mcp/skills/conviction-mcp-setup
          </code>
          .
        </p>
        <CopyBlock label="SKILL.md" value={skillMarkdown} />
        <pre className="mt-5 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-[18px] border border-line bg-surface-2 px-5 py-4 font-mono text-xs leading-5 text-ink">
          {skillMarkdown}
        </pre>
      </section>
    </div>
  );
}
