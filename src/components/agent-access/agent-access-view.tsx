"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useAccount } from "@/components/account/account-context";
import {
  AgentSettingsPanel,
  agentSettingsFormKey,
} from "@/components/agent-access/agent-settings-panel";
import { AgentSkillHandoff } from "@/components/agent-access/agent-skill-handoff";
import { SetupActionPanel, type SetupAgent } from "@/components/agent-access/setup-action-panel";
import { SetupProgressRail } from "@/components/agent-access/setup-progress-rail";
import {
  SETUP_CONTRACT,
  defaultProfileName,
  resolveSetupPhase,
} from "@getconviction/mcp/setup-contract";

function subscribeNoop() {
  return () => {};
}

function useSetupSkillUrl(): string {
  return useSyncExternalStore(
    subscribeNoop,
    () => `${window.location.origin}/agent-access/skill`,
    () => "/agent-access/skill",
  );
}

type Handoff = {
  code: string;
  command: string;
  expiresAt: string;
};

type ApiError = { error?: { code?: string; message?: string } };

type AgentNotification = {
  notificationId: string;
  agentId: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  createdAt: string;
};

const POLL_MS = 4000;

const DEFAULT_FORM = {
  handle: "",
  returnAddress: "",
  maxTradeUsd: "25",
  spendBudgetUsd: "100",
  trade: true,
  back: true,
  publish: true,
};

function statusEyebrow(status: SetupAgent["status"]): string {
  switch (status) {
    case "provisioning":
      return "Pending agent";
    case "active":
      return "Your agent";
    case "disabled":
    case "capped":
    case "retiring":
    case "retired":
      return "Agent status";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function statusLabel(status: SetupAgent["status"]): string {
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

function notificationTone(severity: AgentNotification["severity"]): string {
  switch (severity) {
    case "info":
      return "bg-surface-2 text-ink-2";
    case "warning":
      return "bg-[#fff3d6] text-warning";
    case "critical":
      return "bg-red-50 text-danger";
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}

function normalizeAgent(raw: Partial<SetupAgent> & {
  agentId: string;
  handle: string;
  operatorHandle: string;
  status: SetupAgent["status"];
}): SetupAgent {
  const spendBudgetUsd = Number(raw.spendBudgetUsd ?? 0);
  const lifetimeSpendUsd = Number(raw.lifetimeSpendUsd ?? 0);
  const remainingBudgetUsd =
    typeof raw.remainingBudgetUsd === "number"
      ? raw.remainingBudgetUsd
      : Math.max(0, spendBudgetUsd - lifetimeSpendUsd);
  return {
    agentId: raw.agentId,
    handle: raw.handle,
    operatorHandle: raw.operatorHandle,
    address: raw.address ?? null,
    status: raw.status,
    publicStatus: raw.publicStatus ?? "paused",
    actionPolicy: raw.actionPolicy ?? {
      trade: true,
      back: true,
      publish: true,
    },
    maxTradeUsd: Number(raw.maxTradeUsd ?? 0),
    spendBudgetUsd,
    lifetimeSpendUsd,
    remainingBudgetUsd,
    privatePausedReason: raw.privatePausedReason ?? null,
    fundingReady: raw.fundingReady === true,
    setupVerifiedAt: raw.setupVerifiedAt ?? null,
  };
}

export function AgentAccessView() {
  const account = useAccount();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [agent, setAgent] = useState<SetupAgent | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const skillUrl = useSetupSkillUrl();

  const authenticatedFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = await account.getAccessToken();
      if (!token) throw new Error("Sign in to Conviction and try again.");
      return fetch(input, {
        ...init,
        headers: {
          ...init?.headers,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      });
    },
    [account],
  );

  const refreshNotifications = useCallback(async () => {
    try {
      const response = await authenticatedFetch(
        "/api/agents/notifications?limit=10",
      );
      const payload = (await response.json()) as {
        notifications?: AgentNotification[];
      } & ApiError;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Could not load notifications.",
        );
      }
      setNotifications(payload.notifications ?? []);
    } catch {
      // Notifications are supplemental; do not disrupt agent setup on failure.
    }
  }, [authenticatedFetch]);

  const fetchAgent = useCallback(async (): Promise<SetupAgent | null> => {
    const response = await authenticatedFetch("/api/agents");
    const payload = (await response.json()) as {
      agent?: SetupAgent | null;
    } & ApiError;
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Could not load Agent Access.");
    }
    return payload.agent ? normalizeAgent(payload.agent) : null;
  }, [authenticatedFetch]);

  const refreshAgent = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) setRefreshing(true);
      try {
        const next = await fetchAgent();
        setAgent(next);
        setError(null);
        void refreshNotifications();
      } catch (reason) {
        if (!silent) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load Agent Access.",
          );
        }
      } finally {
        setLoading(false);
        if (!silent) setRefreshing(false);
      }
    },
    [fetchAgent, refreshNotifications],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchAgent()
      .then((next) => {
        if (cancelled) return;
        setAgent(next);
        setError(null);
        void refreshNotifications();
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load Agent Access.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAgent, refreshNotifications]);

  const phase = useMemo(
    () =>
      resolveSetupPhase(
        agent
          ? {
              status: agent.status,
              fundingReady: agent.fundingReady,
              setupVerifiedAt: agent.setupVerifiedAt,
            }
          : null,
      ),
    [agent],
  );

  const shouldPoll =
    phase.kind === "provision" ||
    phase.kind === "backup" ||
    phase.kind === "verify";

  useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => {
      void refreshAgent({ silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPoll, refreshAgent]);

  useEffect(() => {
    if (!shouldPoll) return;
    const onFocus = () => {
      void refreshAgent({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [shouldPoll, refreshAgent]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agents", {
        method: "POST",
        body: JSON.stringify({
          handle: form.handle,
          returnAddress: form.returnAddress,
          maxTradeUsd: form.maxTradeUsd,
          spendBudgetUsd: form.spendBudgetUsd,
          actionPolicy: {
            trade: form.trade,
            back: form.back,
            publish: form.publish,
          },
        }),
      });
      const payload = (await response.json()) as {
        agent?: SetupAgent;
        handoff?: Handoff;
      } & ApiError;
      if (!response.ok || !payload.agent || !payload.handoff) {
        throw new Error(payload.error?.message ?? "Could not create the agent.");
      }
      setAgent(normalizeAgent(payload.agent));
      setHandoff(payload.handoff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the agent.");
    } finally {
      setSubmitting(false);
    }
  }

  const profileName = agent ? defaultProfileName(agent.handle) : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="app-card overflow-hidden">
        <div className="grid gap-8 p-7 sm:p-9 lg:grid-cols-[1.2fr_0.8fr] lg:p-11">
          <div>
            <p className="pt-eyebrow">One agent. Keys stay yours.</p>
            <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
              Give your local agent a Conviction identity.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-ink-2">
              Reserve a public handle and set its spending boundaries here. The local CLI creates the signer on your machine—Conviction never receives the private key.
            </p>
          </div>
          <div className="rounded-[22px] border border-warning/25 bg-[#fff8e8] p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-warning">
              Irrecoverable by design
            </p>
            <p className="mt-3 text-sm leading-6 text-ink-2">
              Conviction cannot recover, reset, or replace your signer. Losing every encrypted keystore copy or its unlock secret can permanently strand agent funds.
            </p>
          </div>
        </div>
      </section>

      <section className="app-card p-7 sm:p-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="pt-eyebrow">Setup contract v{SETUP_CONTRACT.version}</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
              Operator setup journey
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink-2">
              {phase.nextAction}
              {shouldPoll
                ? " This page refreshes automatically while setup is in progress."
                : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/agent-access/skill"
              className="rounded-[14px] border border-line bg-surface-2 px-4 py-2.5 text-sm font-extrabold text-ink transition hover:border-brand hover:text-brand"
            >
              Setup skill
            </Link>
            <button
              type="button"
              onClick={() => void refreshAgent()}
              disabled={refreshing || loading}
              className="rounded-[14px] bg-brand px-4 py-2.5 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="mt-6">
          <SetupProgressRail phase={phase} />
        </div>
      </section>

      <AgentSkillHandoff
        skillUrl={skillUrl}
        {...(profileName ? { profileName } : {})}
      />

      {error && (
        <div role="alert" className="rounded-[18px] border border-danger/25 bg-red-50 px-5 py-4 text-sm font-semibold text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <section className="app-card p-8 text-sm text-ink-3">Checking your agent slot…</section>
      ) : agent ? (
        <>
          <section className="app-card p-7 sm:p-9">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="pt-eyebrow">{statusEyebrow(agent.status)}</p>
                <h2 className="mt-2 font-display text-3xl font-semibold text-ink">@{agent.handle}</h2>
                <p className="mt-2 text-sm text-ink-3">Agent · operated by @{agent.operatorHandle}</p>
              </div>
              <span className="rounded-full bg-[#fff3d6] px-3 py-1.5 text-xs font-extrabold text-warning">
                {statusLabel(agent.status)}
              </span>
            </div>
            <SetupActionPanel phase={phase} agent={agent} handoff={handoff} />
          </section>
          <section className="app-card p-7 sm:p-9">
            <div>
              <p className="pt-eyebrow">Operator notifications</p>
              <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
                Recent activity
              </h2>
            </div>
            {notifications.length ? (
              <ul className="mt-5 divide-y divide-line">
                {notifications.map((notification) => (
                  <li key={notification.notificationId} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-ink">{notification.title}</p>
                        <p className="mt-1 text-sm leading-6 text-ink-2">{notification.body}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold capitalize ${notificationTone(notification.severity)}`}>
                        {notification.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-ink-3">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm leading-6 text-ink-3">
                Trade, back, and reconciliation updates will appear here.
              </p>
            )}
          </section>
          <AgentSettingsPanel
            key={agentSettingsFormKey(agent)}
            agent={agent}
            authenticatedFetch={authenticatedFetch}
            onUpdated={(next) => {
              setAgent({
                ...agent,
                ...next,
              });
            }}
          />
        </>
      ) : (
        <form onSubmit={submit} className="app-card p-7 sm:p-9">
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-5">
              <div>
                <label htmlFor="agent-handle" className="text-sm font-extrabold text-ink">Agent handle</label>
                <div className="mt-2 flex items-center rounded-[14px] app-input">
                  <span className="pl-4 text-ink-3">@</span>
                  <input id="agent-handle" required minLength={3} maxLength={30} value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} placeholder="signal-scout" className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none" />
                </div>
                <p className="mt-2 text-xs leading-5 text-ink-3">Public and globally unique. Conflicts with human or agent handles will be rejected.</p>
              </div>
              <div>
                <label htmlFor="return-address" className="text-sm font-extrabold text-ink">Retirement return address</label>
                <input id="return-address" required value={form.returnAddress} onChange={(event) => setForm({ ...form, returnAddress: event.target.value })} placeholder="0x…" autoComplete="off" className="app-input mt-2 w-full rounded-[14px] px-4 py-3 font-mono text-sm" />
                <p className="mt-2 text-xs leading-5 text-ink-3">Used only by the operator-only retirement flow. This is not signer material.</p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <label className="text-sm font-extrabold text-ink">Per-trade limit
                  <div className="app-input mt-2 flex rounded-[14px]"><span className="pl-4 py-3 text-ink-3">$</span><input required type="number" min="1" step="1" value={form.maxTradeUsd} onChange={(event) => setForm({ ...form, maxTradeUsd: event.target.value })} className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none" /></div>
                </label>
                <label className="text-sm font-extrabold text-ink">Lifetime budget
                  <div className="app-input mt-2 flex rounded-[14px]"><span className="pl-4 py-3 text-ink-3">$</span><input required type="number" min="1" step="1" value={form.spendBudgetUsd} onChange={(event) => setForm({ ...form, spendBudgetUsd: event.target.value })} className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none" /></div>
                </label>
              </div>
              <fieldset>
                <legend className="text-sm font-extrabold text-ink">Allowed actions</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["trade", "back", "publish"] as const).map((action) => (
                    <label key={action} className="flex cursor-pointer items-center gap-2 rounded-[14px] border border-line bg-surface-2 px-3 py-3 text-sm font-bold capitalize text-ink-2">
                      <input type="checkbox" checked={form[action]} onChange={(event) => setForm({ ...form, [action]: event.target.checked })} className="accent-brand" />
                      {action}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
            <p className="max-w-xl text-xs leading-5 text-ink-3">Creating reserves your single v1 agent slot and produces a handoff valid for ten minutes. It does not create a wallet or move funds.</p>
            <button disabled={submitting} type="submit" className="rounded-[15px] bg-brand px-6 py-3 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55">
              {submitting ? "Reserving agent…" : "Create pending agent"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
