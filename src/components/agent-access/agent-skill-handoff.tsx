"use client";

import Link from "next/link";
import { CopyBlock } from "@/components/agent-access/copy-block";
import { buildAgentSetupHandoffPrompt } from "@/lib/mcp-setup-handoff";

export function AgentSkillHandoff({
  skillUrl,
  profileName,
  compact = false,
}: {
  skillUrl: string;
  profileName?: string;
  compact?: boolean;
}) {
  const prompt = buildAgentSetupHandoffPrompt({
    skillUrl,
    ...(profileName ? { profileName } : {}),
  });

  return (
    <section className="rounded-[22px] border border-line p-6">
      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
        Pass to your agent
      </p>
      <h3 className="mt-2 font-display text-xl font-semibold text-ink">
        Setup skill handoff
      </h3>
      <p className="mt-2 text-sm leading-6 text-ink-2">
        Copy this into Claude Code, Codex, Hermes, or OpenClaw before connecting
        Conviction MCP. It points at the public setup skill and forbids
        provisioning, funding, policy changes, and secret access.
      </p>
      <CopyBlock label="Agent prompt" value={prompt} />
      {!compact ? (
        <p className="mt-4 text-sm leading-6 text-ink-2">
          Full skill:{" "}
          <Link
            href="/agent-access/skill"
            className="font-extrabold text-brand underline-offset-2 hover:underline"
          >
            View / copy the setup skill
          </Link>
        </p>
      ) : (
        <p className="mt-4 text-xs leading-5 text-ink-3">
          Skill URL embedded above: {skillUrl}
        </p>
      )}
    </section>
  );
}
