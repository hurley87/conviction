"use client";

import { generateHostConfigs } from "@getconviction/mcp/host-config";
import {
  SETUP_CONTRACT,
  defaultProfileName,
  type SetupPhase,
} from "@getconviction/mcp/setup-contract";
import { CopyBlock } from "@/components/agent-access/copy-block";

type AgentStatus =
  | "provisioning"
  | "active"
  | "disabled"
  | "capped"
  | "retiring"
  | "retired";

export type SetupAgent = {
  agentId: string;
  handle: string;
  operatorHandle: string;
  address: string | null;
  status: AgentStatus;
  publicStatus: "active" | "paused" | "retired";
  actionPolicy: { trade: boolean; back: boolean; publish: boolean };
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  remainingBudgetUsd: number;
  privatePausedReason: string | null;
  fundingReady: boolean;
  setupVerifiedAt: string | null;
};

type Handoff = {
  code: string;
  command: string;
  expiresAt: string;
};

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "provisioning":
      return "Awaiting local signer";
    case "active":
      return "Active";
    case "disabled":
      return "Disabled";
    case "capped":
      return "Spend capped";
    case "retiring":
      return "Retiring";
    case "retired":
      return "Retired";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function RegenerateButton({
  regenerating,
  onClick,
  variant,
}: {
  regenerating: boolean;
  onClick: () => void;
  variant: "secondary" | "primary";
}) {
  const variantClass =
    variant === "primary"
      ? "bg-brand text-brand-on hover:bg-brand-hover"
      : "border border-line bg-surface text-ink hover:border-brand hover:text-brand";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={regenerating}
      className={`mt-4 rounded-[14px] px-4 py-2.5 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-55 ${variantClass}`}
    >
      {regenerating ? "Regenerating…" : "Regenerate handoff"}
    </button>
  );
}

export function SetupActionPanel({
  phase,
  agent,
  handoff,
  regenerating = false,
  onRegenerateHandoff,
}: {
  phase: SetupPhase;
  agent: SetupAgent;
  handoff: Handoff | null;
  regenerating?: boolean;
  onRegenerateHandoff?: () => void;
}) {
  const profileName = defaultProfileName(agent.handle);
  const doctorCommand = `conviction-mcp doctor --profile ${profileName}`;

  switch (phase.kind) {
    case "provision":
      return handoff ? (
        <div className="mt-7 rounded-[22px] border border-brand/15 bg-brand-soft/45 p-6">
          <p className="text-sm font-extrabold text-ink">Next: provision locally</p>
          <p className="mt-2 text-sm leading-6 text-ink-2">
            Paste and run this command. It prompts for a recovery passphrase,
            verifies the encrypted backup, and runs doctor. Valid until{" "}
            {new Date(handoff.expiresAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            . You can regenerate a fresh code until init completes.
          </p>
          <CopyBlock label="Init command" value={handoff.command} />
          {onRegenerateHandoff ? (
            <RegenerateButton
              regenerating={regenerating}
              onClick={onRegenerateHandoff}
              variant="secondary"
            />
          ) : null}
        </div>
      ) : (
        <div className="mt-7 rounded-[18px] border border-line bg-surface-2 px-5 py-4 text-sm leading-6 text-ink-2">
          <p>
            The one-time handoff is not on this page. If init has not finished,
            regenerate a fresh command below.
          </p>
          {onRegenerateHandoff ? (
            <RegenerateButton
              regenerating={regenerating}
              onClick={onRegenerateHandoff}
              variant="primary"
            />
          ) : null}
        </div>
      );

    case "backup":
      return (
        <div className="mt-7 rounded-[18px] border border-warning/25 bg-[#fff8e8] px-5 py-4 text-sm leading-6 text-ink-2">
          Local signer is bound, but setup stays locked until the CLI finishes
          backup export and decrypt-verification. Resume{" "}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
            conviction-mcp init
          </code>{" "}
          with the same code and profile—successful init also runs doctor.
        </div>
      );

    case "verify": {
      const hostConfigs = generateHostConfigs({ profileName });
      return (
        <div className="mt-7 space-y-6">
          <div className="rounded-[18px] border border-brand/15 bg-brand-soft/45 px-5 py-4 text-sm leading-6 text-ink-2">
            <p className="font-extrabold text-ink">
              Next: paste a host config (or re-run doctor)
            </p>
            <p className="mt-2">
              Backup is verified. Successful{" "}
              <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
                conviction-mcp init
              </code>{" "}
              already runs doctor—re-run only if verification did not complete.
              Then add one MCP host with the shared v1 contract.
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-3">
              Snippets default the profile name to{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5">{profileName}</code>
              . If you passed a custom{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5">--profile</code>{" "}
              during init, substitute that name. The profile stores the API base
              from init, so host snippets do not need{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5">--api-base</code>.
            </p>
            <CopyBlock label="Doctor command" value={doctorCommand} />
          </div>

          <div className="rounded-[22px] border border-line p-6">
            <p className="text-sm font-extrabold text-ink">Host configuration</p>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              {SETUP_CONTRACT.sharedMcpContractNote} Package pin:{" "}
              <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
                {SETUP_CONTRACT.packageMajorPin}
              </code>
              .
            </p>
            <div className="mt-5 space-y-6">
              {hostConfigs.map((snippet) => (
                <div key={snippet.hostId}>
                  <p className="text-sm font-extrabold text-ink">{snippet.label}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-3">
                    {snippet.description}
                  </p>
                  <CopyBlock label="Configuration" value={snippet.primary} />
                  {snippet.secondary ? (
                    <CopyBlock
                      label={snippet.secondary.label}
                      value={snippet.secondary.content}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs leading-5 text-ink-3">
              Supported platforms: macOS, Linux, and Windows through WSL. Native
              Windows is deferred.
            </p>
          </div>

          {agent.address ? (
            <div className="rounded-[18px] border border-line bg-surface-2 px-5 py-4 text-sm leading-6 text-ink-2">
              <p className="font-extrabold text-ink">
                Funding stays secondary until doctor succeeds
              </p>
              <p className="mt-2">
                Deposit address is reserved after backup verification, but Agent
                Access only suggests funding after local verification.
              </p>
              <p className="mt-3">
                <span className="font-extrabold text-ink">Deposit address:</span>{" "}
                <code className="break-all rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs text-ink">
                  {agent.address}
                </code>
              </p>
            </div>
          ) : null}
        </div>
      );
    }

    case "fund":
      return (
        <div className="mt-7 space-y-4 rounded-[18px] border border-brand/15 bg-brand-soft/45 px-5 py-4 text-sm leading-6 text-ink-2">
          <p className="font-extrabold text-ink">Local verification recorded</p>
          <p>
            Doctor recorded a successful non-value-moving check
            {agent.setupVerifiedAt
              ? ` at ${new Date(agent.setupVerifiedAt).toLocaleString()}`
              : ""}
            . You can fund the Universal Account now.
          </p>
          {agent.address ? (
            <p>
              <span className="font-extrabold text-ink">Deposit address:</span>{" "}
              <code className="break-all rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs text-ink">
                {agent.address}
              </code>
            </p>
          ) : null}
          <CopyBlock label="Re-run diagnostics" value={doctorCommand} />
        </div>
      );

    case "terminal":
      return (
        <div className="mt-7 rounded-[18px] border border-line bg-surface-2 px-5 py-4 text-sm leading-6 text-ink-2">
          This account already holds its v1 agent slot (
          {statusLabel(agent.status).toLowerCase()}). {phase.nextAction}
        </div>
      );

    case "create":
      return null;

    default: {
      const _exhaustive: never = phase.kind;
      return _exhaustive;
    }
  }
}
