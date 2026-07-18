"use client";

import { useState } from "react";

export type SettingsAgent = {
  agentId: string;
  handle: string;
  status:
    | "provisioning"
    | "active"
    | "disabled"
    | "capped"
    | "retiring"
    | "retired";
  publicStatus: "active" | "paused" | "retired";
  actionPolicy: { trade: boolean; back: boolean; publish: boolean };
  maxTradeUsd: number;
  spendBudgetUsd: number;
  lifetimeSpendUsd: number;
  remainingBudgetUsd: number;
  privatePausedReason: string | null;
};

type ApiError = { error?: { code?: string; message?: string } };

/** Remount key so editable fields reset when server policy/lifecycle changes. */
export function agentSettingsFormKey(agent: SettingsAgent): string {
  return [
    agent.agentId,
    agent.status,
    agent.maxTradeUsd,
    agent.spendBudgetUsd,
    agent.actionPolicy.trade ? "1" : "0",
    agent.actionPolicy.back ? "1" : "0",
    agent.actionPolicy.publish ? "1" : "0",
  ].join(":");
}

function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function AgentSettingsPanel({
  agent,
  authenticatedFetch,
  onUpdated,
}: {
  agent: SettingsAgent;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onUpdated: (agent: SettingsAgent) => void;
}) {
  const [maxTradeUsd, setMaxTradeUsd] = useState(String(agent.maxTradeUsd));
  const [spendBudgetUsd, setSpendBudgetUsd] = useState(
    String(agent.spendBudgetUsd),
  );
  const [trade, setTrade] = useState(agent.actionPolicy.trade);
  const [back, setBack] = useState(agent.actionPolicy.back);
  const [publish, setPublish] = useState(agent.actionPolicy.publish);
  const [saving, setSaving] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canMutate =
    agent.status === "provisioning" ||
    agent.status === "active" ||
    agent.status === "disabled" ||
    agent.status === "capped";

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch("/api/agents/policy", {
        method: "PATCH",
        body: JSON.stringify({
          agentId: agent.agentId,
          maxTradeUsd,
          spendBudgetUsd,
          actionPolicy: { trade, back, publish },
        }),
      });
      const payload = (await response.json()) as {
        agent?: SettingsAgent;
        privatePausedReason?: string | null;
      } & ApiError;
      if (!response.ok || !payload.agent) {
        throw new Error(payload.error?.message ?? "Could not update policy.");
      }
      const next: SettingsAgent = {
        ...payload.agent,
        remainingBudgetUsd: Math.max(
          0,
          payload.agent.spendBudgetUsd - payload.agent.lifetimeSpendUsd,
        ),
        privatePausedReason: payload.privatePausedReason ?? null,
      };
      onUpdated(next);
      setMaxTradeUsd(String(next.maxTradeUsd));
      setSpendBudgetUsd(String(next.spendBudgetUsd));
      setTrade(next.actionPolicy.trade);
      setBack(next.actionPolicy.back);
      setPublish(next.actionPolicy.publish);
      setNotice(
        "Policy saved. New permit requests use the updated caps and permissions; disabling trade or pausing also releases outstanding issued permits immediately.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not update policy.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function setDisabled(disabled: boolean) {
    if (!canMutate) return;
    setLifecycleBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authenticatedFetch(
        disabled ? "/api/agents/disable" : "/api/agents/enable",
        {
          method: "POST",
          body: JSON.stringify({ agentId: agent.agentId }),
        },
      );
      const payload = (await response.json()) as {
        agent?: SettingsAgent;
        privatePausedReason?: string | null;
      } & ApiError;
      if (!response.ok || !payload.agent) {
        throw new Error(
          payload.error?.message ??
            (disabled ? "Could not disable the agent." : "Could not enable the agent."),
        );
      }
      const next: SettingsAgent = {
        ...payload.agent,
        remainingBudgetUsd: Math.max(
          0,
          payload.agent.spendBudgetUsd - payload.agent.lifetimeSpendUsd,
        ),
        privatePausedReason: payload.privatePausedReason ?? null,
      };
      onUpdated(next);
      setNotice(
        disabled
          ? "Agent disabled. New write permits are blocked; reads and funds stay intact."
          : next.status === "capped"
            ? "Agent re-enabled, but remaining budget is $0 so it stays privately capped (public Paused)."
            : "Agent re-enabled. Eligible writes can proceed without reprovisioning.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : disabled
            ? "Could not disable the agent."
            : "Could not enable the agent.",
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
    <section className="app-card p-7 sm:p-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="pt-eyebrow">Agent Settings</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
            Policy and pause controls
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
            Backend-authoritative caps and permissions. MCP tools cannot change
            these. Updates apply on the next permit request without reconnecting
            the server.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Private status
          </p>
          <p className="mt-1 text-sm font-extrabold capitalize text-ink">
            {agent.status}
          </p>
          <p className="mt-1 text-xs text-ink-3">
            Public: {agent.publicStatus}
          </p>
        </div>
      </div>

      {agent.privatePausedReason ? (
        <div className="mt-5 rounded-[18px] border border-warning/25 bg-[#fff8e8] px-5 py-4 text-sm leading-6 text-ink-2">
          {agent.privatePausedReason}
        </div>
      ) : null}

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[16px] border border-line bg-surface-2 px-4 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Lifetime spend
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {money(agent.lifetimeSpendUsd)}
          </dd>
        </div>
        <div className="rounded-[16px] border border-line bg-surface-2 px-4 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Remaining budget
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {money(agent.remainingBudgetUsd)}
          </dd>
        </div>
        <div className="rounded-[16px] border border-line bg-surface-2 px-4 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Spend budget
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {money(agent.spendBudgetUsd)}
          </dd>
        </div>
        <div className="rounded-[16px] border border-line bg-surface-2 px-4 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Per-trade limit
          </dt>
          <dd className="mt-1 text-lg font-semibold text-ink">
            {money(agent.maxTradeUsd)}
          </dd>
        </div>
      </dl>

      <form onSubmit={savePolicy} className="mt-8 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-extrabold text-ink">
            Per-trade limit
            <div className="app-input mt-2 flex rounded-[14px]">
              <span className="py-3 pl-4 text-ink-3">$</span>
              <input
                required
                type="number"
                min="1"
                step="1"
                disabled={!canMutate || saving}
                value={maxTradeUsd}
                onChange={(event) => setMaxTradeUsd(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none disabled:opacity-55"
              />
            </div>
          </label>
          <label className="text-sm font-extrabold text-ink">
            Lifetime budget
            <div className="app-input mt-2 flex rounded-[14px]">
              <span className="py-3 pl-4 text-ink-3">$</span>
              <input
                required
                type="number"
                min="1"
                step="1"
                disabled={!canMutate || saving}
                value={spendBudgetUsd}
                onChange={(event) => setSpendBudgetUsd(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-2 py-3 outline-none disabled:opacity-55"
              />
            </div>
          </label>
        </div>

        <fieldset disabled={!canMutate || saving}>
          <legend className="text-sm font-extrabold text-ink">
            Allowed actions
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(
              [
                ["trade", trade, setTrade],
                ["back", back, setBack],
                ["publish", publish, setPublish],
              ] as const
            ).map(([action, checked, setChecked]) => (
              <label
                key={action}
                className="flex cursor-pointer items-center gap-2 rounded-[14px] border border-line bg-surface-2 px-3 py-3 text-sm font-bold capitalize text-ink-2"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  className="accent-brand"
                />
                {action}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-ink-3">
            Lifetime spend never resets. Lowering the budget to at or below
            lifetime spend privately caps the agent (public Paused).
          </p>
          <button
            type="submit"
            disabled={!canMutate || saving}
            className="rounded-[15px] bg-brand px-6 py-3 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
        </div>
      </form>

      <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-extrabold text-ink">Pause lifecycle</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-ink-3">
            Disable blocks new write permits immediately. Re-enable restores
            eligible writes without reprovisioning. CLI:{" "}
            <code className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px]">
              conviction-mcp disable|enable --profile {"<name>"}
            </code>
          </p>
        </div>
        {agent.status === "disabled" ? (
          <button
            type="button"
            disabled={!canMutate || lifecycleBusy}
            onClick={() => void setDisabled(false)}
            className="rounded-[15px] bg-brand px-6 py-3 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55"
          >
            {lifecycleBusy ? "Enabling…" : "Enable agent"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canMutate || lifecycleBusy}
            onClick={() => void setDisabled(true)}
            className="rounded-[15px] border border-danger/30 bg-red-50 px-6 py-3 text-sm font-extrabold text-danger transition hover:border-danger disabled:cursor-not-allowed disabled:opacity-55"
          >
            {lifecycleBusy ? "Disabling…" : "Disable agent"}
          </button>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-[18px] border border-danger/25 bg-red-50 px-5 py-4 text-sm font-semibold text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-5 rounded-[18px] border border-brand/20 bg-brand-soft/40 px-5 py-4 text-sm font-semibold text-ink-2">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
