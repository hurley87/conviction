"use client";

import { generateHostConfigs } from "@conviction/mcp/host-config";
import {
  SETUP_CONTRACT,
  defaultProfileName,
  type SetupPhase,
} from "@conviction/mcp/setup-contract";
import { CopyBlock } from "@/components/agent-access/copy-block";

type AgentStatus =
  | "provisioning"
  | "active"
  | "disabled"
  | "capped"
  | "retiring"
  | "retired";

export type SetupAgent = {
  handle: string;
  operatorHandle: string;
  address: string | null;
  status: AgentStatus;
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

export function SetupActionPanel({
  phase,
  agent,
  handoff,
}: {
  phase: SetupPhase;
  agent: SetupAgent;
  handoff: Handoff | null;
}) {
  const profileName = defaultProfileName(agent.handle);
  const doctorCommand = `conviction-mcp doctor --profile ${profileName}`;

  switch (phase.kind) {
    case "provision":
      return handoff ? (
        <div className="mt-7 rounded-[22px] border border-brand/15 bg-brand-soft/45 p-6">
          <p className="text-sm font-extrabold text-ink">Next: provision locally</p>
          <p className="mt-2 text-sm leading-6 text-ink-2">
            Run it before{" "}
            {new Date(handoff.expiresAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
            . It will not be shown again after you leave this page. Export and
            decrypt-verify the encrypted backup in the CLI before verifying locally.
          </p>
          <CopyBlock label="Init command" value={handoff.command} />
        </div>
      ) : (
        <div className="mt-7 rounded-[18px] border border-line bg-surface-2 px-5 py-4 text-sm leading-6 text-ink-2">
          This account already used its one-time handoff. Return to the local
          terminal where you began setup, or wait for a future recovery flow.
        </div>
      );

    case "backup":
      return (
        <div className="mt-7 rounded-[18px] border border-warning/25 bg-[#fff8e8] px-5 py-4 text-sm leading-6 text-ink-2">
          Local signer is bound, but setup stays locked until the CLI exports and
          decrypt-verifies an encrypted backup. Resume{" "}
          <code className="rounded bg-ink/5 px-1.5 py-0.5 text-xs">
            conviction-mcp init
          </code>{" "}
          with the same code and profile—no host configs or deposit address are
          shown here yet.
        </div>
      );

    case "verify": {
      const hostConfigs = generateHostConfigs({ profileName });
      return (
        <div className="mt-7 space-y-6">
          <div className="rounded-[18px] border border-brand/15 bg-brand-soft/45 px-5 py-4 text-sm leading-6 text-ink-2">
            <p className="font-extrabold text-ink">
              Next: configure a host, then run doctor
            </p>
            <p className="mt-2">
              Backup verified. Add one MCP host with the shared v1 contract, then
              run a non-value-moving doctor check before funding.
            </p>
            <p className="mt-2 text-xs leading-5 text-ink-3">
              Snippets default the profile name to{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5">{profileName}</code>
              . If you passed a custom{" "}
              <code className="rounded bg-ink/5 px-1 py-0.5">--profile</code>{" "}
              during init, substitute that name.
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
