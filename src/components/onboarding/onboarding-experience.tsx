"use client";

import Image from "next/image";
import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account/account-context";
import { LandingPage } from "@/components/landing/landing-page";
import { IS_LIVE } from "@/lib/env";
import {
  clearCurrentLesson,
  createOnboardingState,
  onboardingProgress,
  onboardingReducer,
  ONBOARDING_STEPS,
  performSandboxAction,
  readCurrentLesson,
  writeCurrentLesson,
  type DeckGesture,
  type OnboardingAction,
} from "@/lib/onboarding-machine";
import { validateUsername } from "@/lib/usernames";

const STEP_COPY = [
  ["Your public identity", "Choose how people will recognize your reasoning."],
  ["One account, every move", "Your embedded wallet and unified balance stay out of the way."],
  ["Learn the deck", "Use a practice card to learn the three daily gestures."],
  ["Ask Conviction", "See how research becomes a clear, trade-ready brief."],
  ["Practice a trade", "Size, review, confirm, and receive a simulated receipt."],
  ["Share your reasoning", "Draft a public thesis without posting anything."],
  ["You’re ready", "The real app stays deliberate: you choose every action."],
] as const;

function PracticeCard({ onGesture }: { onGesture: (gesture: DeckGesture) => void }) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const finishPointer = (x: number, y: number) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      onGesture(dx < 0 ? "skip" : "back");
    } else if (dy < -55) {
      onGesture("save");
    }
  };

  return (
    <div>
      <article
        className="touch-none select-none rounded-[28px] border border-line bg-surface p-6 shadow-lg sm:p-8"
        onPointerDown={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => finishPointer(event.clientX, event.clientY)}
        aria-label="Practice conviction card. Swipe left to skip, up to save, or right to back."
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold text-ink">@practice_desk</p>
            <p className="mt-1 text-[11px] text-ink-4">Synthetic lesson card</p>
          </div>
          <span className="rounded-full bg-[var(--pt-mood-calm)] px-3 py-1.5 text-xs font-bold">
            Long ETH
          </span>
        </div>
        <p className="mt-6 pt-eyebrow">Practice thesis</p>
        <p className="mt-2 font-display text-2xl italic leading-snug">
          “Activity is recovering, but this only deserves a small, risk-defined position.”
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
            <strong className="block text-ink">Why now</strong>
            Usage and liquidity are improving together.
          </div>
          <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
            <strong className="block text-ink">What breaks it</strong>
            Activity falls below the prior monthly low.
          </div>
        </div>
      </article>
      <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Practice card actions">
        {([
          ["skip", "←", "Skip"],
          ["save", "↑", "Save"],
          ["back", "→", "Back"],
        ] as const).map(([gesture, arrow, label]) => (
          <button
            key={gesture}
            type="button"
            onClick={() => onGesture(gesture)}
            className="rounded-2xl border border-line-strong bg-surface px-3 py-3 text-sm font-bold transition hover:border-brand"
          >
            <span aria-hidden>{arrow}</span> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfileFailure() {
  const account = useAccount();
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 text-center">
      <div className="max-w-md rounded-[28px] border border-line bg-surface p-8 shadow-md">
        <p className="pt-eyebrow">Profile unavailable</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">Let’s try that again.</h1>
        <p className="mt-3 text-sm text-ink-3">{account.profileError}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={() => void account.retryProfile()} className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-brand-on">Retry</button>
          <button type="button" onClick={account.logout} className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-bold">Sign out</button>
        </div>
      </div>
    </main>
  );
}

export function OnboardingExperience() {
  const account = useAccount();
  const router = useRouter();
  const [state, dispatch] = useReducer(onboardingReducer, undefined, () =>
    createOnboardingState(),
  );
  const [username, setUsername] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(
    "I’m watching ETH because activity is recovering with deeper liquidity. I’m wrong if usage rolls over again.",
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hydratedFor = useRef<string | null>(null);

  const sandbox = (action: OnboardingAction) =>
    performSandboxAction(dispatch, action);

  useEffect(() => {
    if (!account.profileId || hydratedFor.current === account.profileId) return;
    hydratedFor.current = account.profileId;
    const lesson = readCurrentLesson(window.localStorage, account.profileId);
    sandbox({
      type: "go",
      step: account.identitySource === "email" && !account.handle ? 0 : lesson,
    });
    setUsername(account.handle ?? "");
  }, [account.handle, account.identitySource, account.profileId]);

  useEffect(() => {
    if (!account.profileId || hydratedFor.current !== account.profileId) return;
    writeCurrentLesson(window.localStorage, account.profileId, state.step);
    headingRef.current?.focus({ preventScroll: true });
  }, [account.profileId, state.step]);

  if (!account.ready) return <div className="min-h-screen bg-canvas" aria-busy="true" />;
  if (IS_LIVE && !account.authenticated) return <LandingPage />;
  if (account.profileError) return <ProfileFailure />;
  if (!account.profileReady) return <div className="min-h-screen bg-canvas" aria-busy="true" />;

  const current = ONBOARDING_STEPS[state.step];
  const [title, description] = STEP_COPY[state.step];
  const identityValid =
    account.identitySource === "twitter" || validateUsername(username).ok;
  const canContinue =
    current === "identity"
      ? identityValid
      : current === "deck"
        ? Object.values(state.deckGestures).every(Boolean)
        : current === "ask"
          ? state.askAnswered
          : current === "trade"
            ? state.tradePhase === "receipt"
            : current === "conviction"
              ? state.convictionPreviewed
              : true;

  const next = async () => {
    if (current === "identity" && account.identitySource === "email") {
      const validation = validateUsername(username);
      if (!validation.ok) {
        setIdentityError(validation.error);
        return;
      }
      setSaving(true);
      setIdentityError(null);
      try {
        await account.saveHandle(validation.username);
      } catch (error) {
        setIdentityError(error instanceof Error ? error.message : "Could not save that username.");
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    sandbox({ type: "next" });
  };

  const finish = async (href: string) => {
    setSaving(true);
    try {
      if (account.needsOnboarding) await account.completeOnboarding();
      if (account.profileId) clearCurrentLesson(window.localStorage, account.profileId);
      router.replace(href);
    } catch (error) {
      setIdentityError(error instanceof Error ? error.message : "Could not finish onboarding.");
      setSaving(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -right-48 -top-64 h-[620px] w-[680px] rounded-full opacity-45 blur-[110px]" style={{ background: "var(--pt-grad-dawn)" }} />
        <div className="absolute -bottom-72 -left-48 h-[560px] w-[620px] rounded-full opacity-20 blur-[110px]" style={{ background: "var(--pt-grad-dusk)" }} />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Image src="/brand/conviction-lockup.svg" alt="Conviction" width={145} height={37} className="h-9 w-auto" priority />
          <span className="rounded-full border border-warning/30 bg-[#fff5df] px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.09em] text-[#8c5b0f]">
            Practice only—no funds move
          </span>
        </header>

        <div className="mt-6" aria-label={`Onboarding progress: step ${state.step + 1} of ${ONBOARDING_STEPS.length}`}>
          <div className="flex items-center justify-between text-[11px] font-bold text-ink-3">
            <span>Step {state.step + 1} of {ONBOARDING_STEPS.length}</span>
            <span>{onboardingProgress(state.step)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${onboardingProgress(state.step)}%` }} />
          </div>
        </div>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:gap-16 lg:py-10">
          <div className="max-w-lg">
            <p className="pt-eyebrow">{current === "identity" ? "Welcome to Conviction" : "Practice lesson"}</p>
            <h1 ref={headingRef} tabIndex={-1} className="mt-3 font-display text-[clamp(3rem,6vw,5.6rem)] font-medium leading-[0.92] tracking-[-0.045em] outline-none">
              {title}
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-2 sm:text-lg">{description}</p>
            {state.step > 0 && state.step < ONBOARDING_STEPS.length - 1 && (
              <button type="button" onClick={() => void finish("/")} disabled={saving} className="mt-6 text-sm font-bold text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50">
                Skip tour
              </button>
            )}
          </div>

          <div className="min-h-[390px] rounded-[32px] border border-line bg-surface/75 p-5 shadow-lg backdrop-blur-xl sm:p-8 lg:p-10">
            {current === "identity" && (
              <div className="mx-auto max-w-xl">
                {account.identitySource === "twitter" ? (
                  <div className="rounded-[26px] border border-line bg-surface p-6 sm:p-8">
                    <p className="pt-eyebrow">Verified with X</p>
                    <p className="mt-4 font-display text-4xl font-semibold">@{account.handle}</p>
                    <p className="mt-3 text-sm leading-relaxed text-ink-3">Your X handle is your locked public identity. It keeps the name people already know attached to your reasoning.</p>
                  </div>
                ) : (
                  <div>
                    <label htmlFor="onboarding-username" className="block font-display text-2xl font-semibold">Choose a public username</label>
                    <p className="mt-2 text-sm text-ink-3">Signed in as {account.email}. This is what other people will see.</p>
                    <div className="relative mt-6">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3">@</span>
                      <input id="onboarding-username" value={username} onChange={(event) => { setUsername(event.target.value); setIdentityError(null); }} autoComplete="username" spellCheck={false} maxLength={21} aria-describedby="username-help username-error" className="app-input w-full rounded-2xl py-4 pl-9 pr-4 text-base font-bold" placeholder="your_name" />
                    </div>
                    <p id="username-help" className="mt-3 text-xs leading-relaxed text-ink-3">3–20 characters. Lowercase letters, numbers, and underscores. A leading @ is removed.</p>
                    {identityError && <p id="username-error" role="alert" className="mt-3 text-sm font-semibold text-danger">{identityError}</p>}
                  </div>
                )}
              </div>
            )}

            {current === "account" && (
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Embedded wallet", "Created with your login. No seed phrase to copy or browser wallet to connect."],
                  ["Unified balance", "One spendable view across supported networks instead of manual network switching."],
                  ["Adding money", "Use a card or a deposit address when you are ready—never during this lesson."],
                  ["You stay responsible", "Crypto is risky. Routes can fail and every thesis can be wrong. Review every real confirmation."],
                ].map(([label, body], index) => (
                  <article key={label} className="rounded-[24px] bg-surface p-5 shadow-sm">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-soft text-sm font-extrabold text-brand">{index + 1}</span>
                    <h2 className="mt-4 font-display text-xl font-semibold">{label}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-ink-3">{body}</p>
                  </article>
                ))}
              </div>
            )}

            {current === "deck" && (
              <div className="mx-auto max-w-xl">
                <PracticeCard onGesture={(gesture) => sandbox({ type: "deck", gesture })} />
                <p className="mt-4 text-center text-xs text-ink-3" aria-live="polite">
                  {Object.entries(state.deckGestures).filter(([, done]) => done).map(([gesture]) => gesture).join(", ") || "Try each gesture"} {Object.values(state.deckGestures).every(Boolean) ? "— lesson complete" : ""}
                </p>
              </div>
            )}

            {current === "ask" && (
              <div className="mx-auto max-w-2xl">
                <div className="rounded-2xl bg-brand px-5 py-4 text-sm text-brand-on">What changed for ETH this week, and what should I verify before considering a position?</div>
                {!state.askAnswered ? (
                  <button type="button" onClick={() => sandbox({ type: "ask" })} className="mt-6 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on">Run simulated research</button>
                ) : (
                  <div className="mt-5 space-y-3" aria-live="polite">
                    <div className="rounded-2xl border border-line bg-surface p-4"><strong>Research</strong><p className="mt-1 text-sm text-ink-3">Activity recovered while liquid supply stayed stable. This is a deterministic lesson result.</p></div>
                    <div className="rounded-2xl border border-line bg-surface p-4"><strong>Summary</strong><p className="mt-1 text-sm text-ink-3">Momentum improved, but the signal needs confirmation from sustained usage.</p></div>
                    <div className="rounded-2xl border border-line bg-surface p-4"><strong>Trade preparation</strong><p className="mt-1 text-sm text-ink-3">Define a small size, invalidation, and minimum received before requesting a real quote.</p></div>
                    <p className="text-xs text-ink-4">Simulated locally. No LLM or API was called.</p>
                  </div>
                )}
              </div>
            )}

            {current === "trade" && (
              <div className="mx-auto max-w-xl">
                {state.tradePhase === "sizing" && <div><label htmlFor="practice-size" className="font-display text-2xl font-semibold">Choose a practice size</label><p className="mt-2 text-sm text-ink-3">Synthetic available balance: $100</p><input id="practice-size" type="range" min="5" max="100" step="5" value={state.tradeSize} onChange={(event) => sandbox({ type: "trade-size", size: Number(event.target.value) })} className="mt-8 w-full accent-[var(--pt-brand)]" /><p className="mt-4 text-center font-display text-5xl font-semibold">${state.tradeSize}</p><button type="button" onClick={() => sandbox({ type: "trade-phase", phase: "review" })} className="mt-7 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on">Review practice trade</button></div>}
                {state.tradePhase === "review" && <div><p className="pt-eyebrow">Review</p><h2 className="mt-3 font-display text-3xl font-semibold">Back with ${state.tradeSize}</h2><dl className="mt-6 space-y-3 rounded-2xl bg-surface-2 p-5 text-sm"><div className="flex justify-between"><dt>You spend</dt><dd>${state.tradeSize}.00</dd></div><div className="flex justify-between"><dt>Minimum received</dt><dd>{(state.tradeSize / 3600 * 0.99).toFixed(5)} ETH</dd></div><div className="flex justify-between"><dt>Network handling</dt><dd>Simulated</dd></div></dl><button type="button" onClick={() => sandbox({ type: "trade-phase", phase: "pending" })} className="mt-6 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on">Confirm minimum received</button></div>}
                {state.tradePhase === "pending" && <div className="py-10 text-center" aria-live="polite"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-2xl motion-safe:animate-pulse">…</span><h2 className="mt-5 font-display text-3xl font-semibold">Practice trade pending</h2><p className="mt-2 text-sm text-ink-3">No signer, quote, wallet, or transaction API is running.</p><button type="button" onClick={() => sandbox({ type: "trade-phase", phase: "receipt" })} className="mt-7 rounded-full border border-line-strong px-6 py-3 text-sm font-bold">Show fake receipt</button></div>}
                {state.tradePhase === "receipt" && <div className="rounded-[26px] border border-success/20 bg-[#f1f7ef] p-6" aria-live="polite"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#dcebd7] text-xl text-success">✓</span><h2 className="mt-5 font-display text-3xl font-semibold">Practice complete</h2><dl className="mt-5 space-y-2 text-sm text-ink-2"><div className="flex justify-between"><dt>Amount</dt><dd>${state.tradeSize}.00</dd></div><div className="flex justify-between"><dt>Status</dt><dd>Simulated success</dd></div><div className="flex justify-between"><dt>Receipt</dt><dd className="font-mono">practice_0001</dd></div></dl><p className="mt-5 text-xs text-ink-3">This receipt is fake and was never written to activity.</p></div>}
              </div>
            )}

            {current === "conviction" && (
              <div className="mx-auto max-w-2xl">
                {!state.convictionPreviewed ? <div><label htmlFor="practice-thesis" className="font-display text-2xl font-semibold">Draft a practice thesis</label><textarea id="practice-thesis" value={draft} onChange={(event) => setDraft(event.target.value)} rows={6} className="app-input mt-4 w-full resize-none rounded-2xl p-4 text-sm leading-relaxed" /><button type="button" disabled={!draft.trim()} onClick={() => sandbox({ type: "conviction-preview" })} className="mt-5 w-full rounded-full bg-brand py-3 text-sm font-bold text-brand-on disabled:opacity-40">Preview only</button></div> : <article className="rounded-[26px] border border-line bg-surface p-6 shadow-sm"><div className="flex items-center justify-between"><strong>@{account.handle}</strong><span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand">Draft preview</span></div><p className="mt-6 font-display text-2xl italic leading-relaxed">“{draft}”</p><p className="mt-6 border-t border-line pt-4 text-xs text-ink-3">Real posting is always optional and requires a separate explicit action. This draft stays in this lesson only.</p></article>}
              </div>
            )}

            {current === "ready" && (
              <div className="mx-auto max-w-xl py-4 text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-2xl text-brand-on">✓</span>
                <h2 className="mt-6 font-display text-4xl font-semibold">Welcome, @{account.handle}.</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-3">Start with today’s deck. Add money only when you are ready, or ask Conviction to help you research first.</p>
                {identityError && <p role="alert" className="mt-4 text-sm font-semibold text-danger">{identityError}</p>}
                <button type="button" onClick={() => void finish("/")} disabled={saving} className="mt-7 w-full rounded-full bg-brand py-3.5 text-sm font-bold text-brand-on disabled:opacity-50">{saving ? "Opening…" : "Open today’s deck"}</button>
                <div className="mt-3 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => void finish("/settings#add-money")} disabled={saving} className="rounded-full border border-line-strong px-4 py-3 text-sm font-bold">Add money</button><button type="button" onClick={() => void finish("/?ask=1")} disabled={saving} className="rounded-full border border-line-strong px-4 py-3 text-sm font-bold">Ask Conviction</button></div>
              </div>
            )}
          </div>
        </section>

        {current !== "ready" && (
          <footer className="flex items-center justify-between gap-3 border-t border-line py-4">
            <button type="button" onClick={() => sandbox({ type: "back" })} disabled={state.step === 0 || saving} className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-bold disabled:invisible">Back</button>
            <button type="button" onClick={() => void next()} disabled={!canContinue || saving} className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-on disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Saving…" : "Continue"}</button>
          </footer>
        )}
      </div>
    </main>
  );
}
