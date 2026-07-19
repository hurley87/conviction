"use client";

import { useState } from "react";
import type {
  OperatorExecutionStatus,
  OperatorFinalityLeg,
  OperatorFinalityStatus,
  OperatorRetirementStatus,
} from "@/lib/agent-operator-finality";

type RetryResource = OperatorExecutionStatus | OperatorRetirementStatus;
type ApiError = { error?: { message?: string } };

function modeLabel(mode: RetryResource["mode"]): string {
  if (mode === "reconciling") return "Reconciling";
  if (mode === "needs_attention") return "Needs attention";
  return "Resolved";
}

function modeTone(mode: RetryResource["mode"]): string {
  if (mode === "reconciling") return "bg-[#fff3d6] text-warning";
  if (mode === "needs_attention") return "bg-red-50 text-danger";
  return "bg-brand-soft/60 text-brand";
}

function compactId(value: string | null): string {
  if (!value) return "Not assigned";
  return value.length > 22
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : value;
}

export function OperatorFinalityLegView({
  leg,
}: {
  leg: OperatorFinalityLeg;
}) {
  return (
    <li className="rounded-[14px] border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-extrabold capitalize text-ink">
            {leg.action} · {leg.chainName}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-3">{leg.legId}</p>
        </div>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-extrabold capitalize text-ink-2">
          {leg.status.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-ink-3 sm:grid-cols-2">
        <div>
          <dt className="font-extrabold text-ink-2">Provider</dt>
          <dd>{leg.lastProviderStatus ?? "No provider status yet"}</dd>
        </div>
        <div>
          <dt className="font-extrabold text-ink-2">Attempts</dt>
          <dd>{leg.attemptCount}</dd>
        </div>
      </dl>
      {leg.confirmedHashes.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {leg.confirmedHashes.map((confirmed) =>
            confirmed.explorerUrl ? (
              <a
                key={confirmed.hash}
                href={confirmed.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-[10px] border border-brand/25 bg-brand-soft/40 px-2.5 py-1.5 font-mono text-[11px] font-bold text-brand hover:border-brand"
              >
                {confirmed.chainName} confirmed {compactId(confirmed.hash)}
              </a>
            ) : (
              <span
                key={confirmed.hash}
                className="rounded-[10px] bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-2"
              >
                {confirmed.chainName} confirmed {compactId(confirmed.hash)}
              </span>
            ),
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs font-semibold text-ink-3">
          No confirmed transaction hash for this leg.
        </p>
      )}
      {leg.lastError ? (
        <p className="mt-3 text-xs leading-5 text-danger">{leg.lastError}</p>
      ) : null}
    </li>
  );
}

function resourceId(resource: RetryResource): string {
  return resource.resourceType === "execution"
    ? resource.executionId
    : resource.retirementId;
}

function ResourceCard({
  resource,
  busy,
  onRetry,
}: {
  resource: RetryResource;
  busy: boolean;
  onRetry: (resource: RetryResource) => void;
}) {
  const id = resourceId(resource);
  const transactionId =
    resource.resourceType === "execution"
      ? resource.particleTransactionId
      : resource.legs.find((leg) => leg.transactionId)?.transactionId ?? null;
  return (
    <article className="rounded-[18px] border border-line bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
            {resource.resourceType}
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-ink">
            {compactId(id)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-3">
            Particle: {compactId(transactionId)}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${modeTone(resource.mode)}`}
        >
          {modeLabel(resource.mode)}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink-2">
        {resource.recovery.summary}
      </p>
      <ul className="mt-4 grid gap-3">
        {resource.legs.map((leg) => (
          <OperatorFinalityLegView key={leg.legId} leg={leg} />
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs leading-5 text-ink-3">
          <p>
            Workflow: {resource.workflowRunId ?? "not assigned"} · Attempts:{" "}
            {resource.attemptCount}
          </p>
          <p>Updated {new Date(resource.updatedAt).toLocaleString()}</p>
        </div>
        {resource.retrySafe ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetry(resource)}
            className="rounded-[13px] border border-warning/35 bg-[#fff8e8] px-4 py-2 text-xs font-extrabold text-ink transition hover:border-warning disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? "Retrying…" : "Retry read-only reconciliation"}
          </button>
        ) : null}
      </div>
      {resource.recovery.manualActionRequired ? (
        <div className="mt-4 rounded-[14px] border border-danger/20 bg-red-50 px-4 py-3 text-xs leading-5 text-danger">
          <p className="font-extrabold">Manual action required</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {resource.recovery.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </article>
  );
}

export function OperatorFinalityPanel({
  agentId,
  status,
  authenticatedFetch,
  onUpdated,
}: {
  agentId: string;
  status: OperatorFinalityStatus;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onUpdated: (status: OperatorFinalityStatus) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resources: RetryResource[] = [
    ...status.executions.filter((execution) => execution.mode !== "resolved"),
    ...(status.retirement && status.retirement.mode !== "resolved"
      ? [status.retirement]
      : []),
  ];

  async function retry(resource: RetryResource) {
    const id = resourceId(resource);
    setBusyId(id);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agents/finality/retry", {
        method: "POST",
        body: JSON.stringify({
          agentId,
          resourceType: resource.resourceType,
          resourceId: id,
        }),
      });
      const payload = (await response.json()) as {
        status?: RetryResource;
      } & ApiError;
      if (!response.ok || !payload.status) {
        throw new Error(
          payload.error?.message ?? "Could not retry reconciliation.",
        );
      }
      const nextStatus = payload.status;
      onUpdated(
        nextStatus.resourceType === "execution"
          ? {
              ...status,
              executions: status.executions.map((execution) =>
                execution.executionId === nextStatus.executionId
                  ? nextStatus as OperatorExecutionStatus
                  : execution,
              ),
            }
          : {
              ...status,
              retirement: nextStatus as OperatorRetirementStatus,
            },
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not retry reconciliation.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="app-card p-7 sm:p-9">
      <div>
        <p className="pt-eyebrow">Execution finality</p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-ink">
          Pending and recovery work
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
          Confirmed legs link to their explorer. Planned or unconfirmed hashes
          are never linked. Read-only retry cannot sign, re-quote, reserve
          spend, submit a transaction, or move retirement value.
        </p>
      </div>
      {resources.length ? (
        <div className="mt-5 grid gap-4">
          {resources.map((resource) => (
            <ResourceCard
              key={`${resource.resourceType}:${resourceId(resource)}`}
              resource={resource}
              busy={busyId === resourceId(resource)}
              onRetry={(item) => void retry(item)}
            />
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-ink-3">
          No unresolved execution or retirement work.
        </p>
      )}
      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-[14px] border border-danger/25 bg-red-50 px-4 py-3 text-sm font-semibold text-danger"
        >
          {error}
        </div>
      ) : null}
    </section>
  );
}
