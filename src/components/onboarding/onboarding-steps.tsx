"use client";

import type { IdentitySource } from "@/lib/identity";
import type {
  DeckGesture,
  OnboardingState,
  TradePhase,
} from "@/lib/onboarding-machine";
import { PracticeCard } from "@/components/onboarding/practice-card";

export function IdentityStep({
  identitySource,
  handle,
  email,
  username,
  setUsername,
  setIdentityError,
  identityError,
}: {
  identitySource: IdentitySource | null;
  handle: string | null;
  email: string | null;
  username: string;
  setUsername: (value: string) => void;
  setIdentityError: (value: string | null) => void;
  identityError: string | null;
}) {
  if (identitySource === "twitter") {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-[26px] border border-line bg-surface p-6 sm:p-8">
          <p className="pt-eyebrow">Verified with X</p>
          <p className="mt-4 font-display text-4xl font-semibold">@{handle}</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-3">
            Your X handle is your locked public identity. It keeps the name people
            already know attached to your reasoning.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div>
        <label
          htmlFor="onboarding-username"
          className="block font-display text-2xl font-semibold"
        >
          Choose a public username
        </label>
        <p className="mt-2 text-sm text-ink-3">
          Signed in as {email}. This is what other people will see.
        </p>
        <div className="relative mt-6">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3">
            @
          </span>
          <input
            id="onboarding-username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setIdentityError(null);
            }}
            autoComplete="username"
            spellCheck={false}
            maxLength={21}
            aria-describedby="username-help username-error"
            className="app-input w-full rounded-2xl py-4 pl-9 pr-4 text-base font-bold"
            placeholder="your_name"
          />
        </div>
        <p
          id="username-help"
          className="mt-3 text-xs leading-relaxed text-ink-3"
        >
          3–20 characters. Lowercase letters, numbers, and underscores. A leading
          @ is removed.
        </p>
        {identityError && (
          <p
            id="username-error"
            role="alert"
            className="mt-3 text-sm font-semibold text-danger"
          >
            {identityError}
          </p>
        )}
      </div>
    </div>
  );
}

export function AccountStep() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          [
            "Embedded wallet",
            "Created with your login. No seed phrase to copy or browser wallet to connect.",
          ],
          [
            "Unified balance",
            "One spendable view across supported networks instead of manual network switching.",
          ],
          [
            "Adding money",
            "Use a card or a deposit address when you are ready—never during this lesson.",
          ],
          [
            "You stay responsible",
            "Crypto is risky. Routes can fail and every thesis can be wrong. Review every real confirmation.",
          ],
        ] as const
      ).map(([label, body], index) => (
        <article key={label} className="rounded-[24px] bg-surface p-5 shadow-sm">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-sm font-extrabold text-brand">
            {index + 1}
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold">{label}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-3">{body}</p>
        </article>
      ))}
    </div>
  );
}

export function DeckStep({
  state,
  onGesture,
}: {
  state: OnboardingState;
  onGesture: (gesture: DeckGesture) => void;
}) {
  const done = Object.entries(state.deckGestures)
    .filter(([, complete]) => complete)
    .map(([gesture]) => gesture)
    .join(", ");
  const allDone = Object.values(state.deckGestures).every(Boolean);

  return (
    <div className="mx-auto max-w-xl">
      <PracticeCard onGesture={onGesture} />
      <p className="mt-4 text-center text-xs text-ink-3" aria-live="polite">
        {done || "Try each gesture"}
        {allDone ? " — lesson complete" : ""}
      </p>
    </div>
  );
}

export function AskStep({
  answered,
  onAsk,
}: {
  answered: boolean;
  onAsk: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-brand px-5 py-4 text-sm text-brand-on">
        What changed for ETH this week, and what should I verify before considering
        a position?
      </div>
      {!answered ? (
        <button
          type="button"
          onClick={onAsk}
          className="mt-6 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on"
        >
          Run simulated research
        </button>
      ) : (
        <div className="mt-5 space-y-3" aria-live="polite">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <strong>Research</strong>
            <p className="mt-1 text-sm text-ink-3">
              Activity recovered while liquid supply stayed stable. This is a
              deterministic lesson result.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <strong>Summary</strong>
            <p className="mt-1 text-sm text-ink-3">
              Momentum improved, but the signal needs confirmation from sustained
              usage.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <strong>Trade preparation</strong>
            <p className="mt-1 text-sm text-ink-3">
              Define a small size, invalidation, and minimum received before
              requesting a real quote.
            </p>
          </div>
          <p className="text-xs text-ink-4">
            Simulated locally. No LLM or API was called.
          </p>
        </div>
      )}
    </div>
  );
}

export function TradeStep({
  state,
  onSize,
  onPhase,
}: {
  state: OnboardingState;
  onSize: (size: number) => void;
  onPhase: (phase: TradePhase) => void;
}) {
  switch (state.tradePhase) {
    case "sizing":
      return (
        <div className="mx-auto max-w-xl">
          <label
            htmlFor="practice-size"
            className="font-display text-2xl font-semibold"
          >
            Choose a practice size
          </label>
          <p className="mt-2 text-sm text-ink-3">
            Synthetic available balance: $100
          </p>
          <input
            id="practice-size"
            type="range"
            min="5"
            max="100"
            step="5"
            value={state.tradeSize}
            onChange={(event) => onSize(Number(event.target.value))}
            className="mt-8 w-full accent-[var(--pt-brand)]"
          />
          <p className="mt-4 text-center font-display text-5xl font-semibold">
            ${state.tradeSize}
          </p>
          <button
            type="button"
            onClick={() => onPhase("review")}
            className="mt-7 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on"
          >
            Review practice trade
          </button>
        </div>
      );
    case "review":
      return (
        <div className="mx-auto max-w-xl">
          <p className="pt-eyebrow">Review</p>
          <h2 className="mt-3 font-display text-3xl font-semibold">
            Back with ${state.tradeSize}
          </h2>
          <dl className="mt-6 space-y-3 rounded-2xl bg-surface-2 p-5 text-sm">
            <div className="flex justify-between">
              <dt>You spend</dt>
              <dd>${state.tradeSize}.00</dd>
            </div>
            <div className="flex justify-between">
              <dt>Minimum received</dt>
              <dd>{((state.tradeSize / 3600) * 0.99).toFixed(5)} ETH</dd>
            </div>
            <div className="flex justify-between">
              <dt>Network handling</dt>
              <dd>Simulated</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => onPhase("pending")}
            className="mt-6 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on"
          >
            Confirm minimum received
          </button>
        </div>
      );
    case "pending":
      return (
        <div className="mx-auto max-w-xl py-10 text-center" aria-live="polite">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-2xl motion-safe:animate-pulse">
            …
          </span>
          <h2 className="mt-5 font-display text-3xl font-semibold">
            Practice trade pending
          </h2>
          <p className="mt-2 text-sm text-ink-3">
            No signer, quote, wallet, or transaction API is running.
          </p>
          <button
            type="button"
            onClick={() => onPhase("receipt")}
            className="mt-7 rounded-full border border-line-strong px-6 py-3 text-sm font-bold"
          >
            Show fake receipt
          </button>
        </div>
      );
    case "receipt":
      return (
        <div
          className="mx-auto max-w-xl rounded-[26px] border border-success/20 bg-[#f1f7ef] p-6"
          aria-live="polite"
        >
          <span className="grid h-12 w-12 place-items-center rounded-full bg-[#dcebd7] text-xl text-success">
            ✓
          </span>
          <h2 className="mt-5 font-display text-3xl font-semibold">
            Practice complete
          </h2>
          <dl className="mt-5 space-y-2 text-sm text-ink-2">
            <div className="flex justify-between">
              <dt>Amount</dt>
              <dd>${state.tradeSize}.00</dd>
            </div>
            <div className="flex justify-between">
              <dt>Status</dt>
              <dd>Simulated success</dd>
            </div>
            <div className="flex justify-between">
              <dt>Receipt</dt>
              <dd className="font-mono">practice_0001</dd>
            </div>
          </dl>
          <p className="mt-5 text-xs text-ink-3">
            This receipt is fake and was never written to activity.
          </p>
        </div>
      );
    default: {
      const _exhaustive: never = state.tradePhase;
      return _exhaustive;
    }
  }
}

export function ConvictionStep({
  handle,
  draft,
  setDraft,
  previewed,
  onPreview,
}: {
  handle: string | null;
  draft: string;
  setDraft: (value: string) => void;
  previewed: boolean;
  onPreview: () => void;
}) {
  if (!previewed) {
    return (
      <div className="mx-auto max-w-2xl">
        <label
          htmlFor="practice-thesis"
          className="font-display text-2xl font-semibold"
        >
          Draft a practice thesis
        </label>
        <textarea
          id="practice-thesis"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={6}
          className="app-input mt-4 w-full resize-none rounded-2xl p-4 text-sm leading-relaxed"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={onPreview}
          className="mt-5 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on disabled:opacity-40"
        >
          Preview only
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <article className="rounded-[26px] border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <strong>@{handle}</strong>
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">
            Draft preview
          </span>
        </div>
        <p className="mt-6 font-display text-2xl italic leading-relaxed">
          “{draft}”
        </p>
        <p className="mt-6 border-t border-line pt-4 text-xs text-ink-3">
          Real posting is always optional and requires a separate explicit action.
          This draft stays in this lesson only.
        </p>
      </article>
    </div>
  );
}

export function ReadyStep({
  handle,
  identityError,
  saving,
  finish,
}: {
  handle: string | null;
  identityError: string | null;
  saving: boolean;
  finish: (href: string) => void;
}) {
  return (
    <div className="mx-auto max-w-xl py-4 text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-2xl text-brand-on">
        ✓
      </span>
      <h2 className="mt-6 font-display text-4xl font-semibold">
        Welcome, @{handle}.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-3">
        Start with today’s deck. Add money only when you are ready, or ask
        Conviction to help you research first.
      </p>
      {identityError && (
        <p role="alert" className="mt-4 text-sm font-semibold text-danger">
          {identityError}
        </p>
      )}
      <button
        type="button"
        onClick={() => void finish("/")}
        disabled={saving}
        className="mt-7 w-full rounded-full bg-brand py-3.5 text-sm font-bold text-brand-on disabled:opacity-50"
      >
        {saving ? "Opening…" : "Open today’s deck"}
      </button>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void finish("/settings#add-money")}
          disabled={saving}
          className="rounded-full border border-line-strong px-4 py-3 text-sm font-bold"
        >
          Add money
        </button>
        <button
          type="button"
          onClick={() => void finish("/?ask=1")}
          disabled={saving}
          className="rounded-full border border-line-strong px-4 py-3 text-sm font-bold"
        >
          Ask Conviction
        </button>
      </div>
    </div>
  );
}
