"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/components/account/account-context";

type PendingAgent = {
  agentId: string;
  handle: string;
  operatorHandle: string;
  status: "provisioning";
  maxTradeUsd: number;
  spendBudgetUsd: number;
};

type Handoff = {
  code: string;
  command: string;
  expiresAt: string;
};

type ApiError = { error?: { code?: string; message?: string } };

const DEFAULT_FORM = {
  handle: "",
  returnAddress: "",
  maxTradeUsd: "25",
  spendBudgetUsd: "100",
  trade: true,
  back: true,
  publish: true,
};

export function AgentAccessView() {
  const account = useAccount();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [agent, setAgent] = useState<PendingAgent | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch("/api/agents")
      .then(async (response) => {
        const payload = (await response.json()) as {
          agent?: PendingAgent | null;
        } & ApiError;
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "Could not load Agent Access.");
        }
        if (!cancelled) setAgent(payload.agent ?? null);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load Agent Access.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticatedFetch]);

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
        agent?: PendingAgent;
        handoff?: Handoff;
      } & ApiError;
      if (!response.ok || !payload.agent || !payload.handoff) {
        throw new Error(payload.error?.message ?? "Could not create the agent.");
      }
      setAgent(payload.agent);
      setHandoff(payload.handoff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the agent.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCommand() {
    if (!handoff) return;
    await navigator.clipboard.writeText(handoff.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

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

      {error && (
        <div role="alert" className="rounded-[18px] border border-danger/25 bg-red-50 px-5 py-4 text-sm font-semibold text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <section className="app-card p-8 text-sm text-ink-3">Checking your agent slot…</section>
      ) : agent ? (
        <section className="app-card p-7 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="pt-eyebrow">Pending agent</p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-ink">@{agent.handle}</h2>
              <p className="mt-2 text-sm text-ink-3">Agent · operated by @{agent.operatorHandle}</p>
            </div>
            <span className="rounded-full bg-[#fff3d6] px-3 py-1.5 text-xs font-extrabold text-warning">Awaiting local signer</span>
          </div>

          {handoff ? (
            <div className="mt-7 rounded-[22px] border border-brand/15 bg-brand-soft/45 p-6">
              <p className="text-sm font-extrabold text-ink">Use this handoff once</p>
              <p className="mt-2 text-sm leading-6 text-ink-2">
                Run it before {new Date(handoff.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. It will not be shown again after you leave this page.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-[14px] bg-ink px-4 py-3 text-sm text-white">{handoff.command}</code>
                <button type="button" onClick={copyCommand} className="rounded-[14px] bg-brand px-5 py-3 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover">
                  {copied ? "Copied" : "Copy command"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-7 rounded-[18px] border border-line bg-surface-2 px-5 py-4 text-sm leading-6 text-ink-2">
              This account already used its one-time handoff. Return to the local terminal where you began setup, or wait for a future recovery flow.
            </div>
          )}
        </section>
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
