"use client";

import Image from "next/image";
import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountGate } from "@/components/account/account-gate";
import { useAccount } from "@/components/account/account-context";
import {
  AccountStep,
  AskStep,
  ConvictionStep,
  DeckStep,
  IdentityStep,
  ReadyStep,
  TradeStep,
} from "@/components/onboarding/onboarding-steps";
import {
  canAdvance,
  clearCurrentLesson,
  createOnboardingState,
  currentOnboardingStep,
  ONBOARDING_STEP_COPY,
  ONBOARDING_STEPS,
  onboardingProgress,
  onboardingReducer,
  readCurrentLesson,
  writeCurrentLesson,
} from "@/lib/onboarding-machine";
import { validateUsername } from "@/lib/usernames";

function OnboardingTour() {
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

  const current = currentOnboardingStep(state);
  const [title, description] = ONBOARDING_STEP_COPY[current];
  const usernameDraftValid = validateUsername(username).ok;
  const continueEnabled = canAdvance(current, state, {
    source: account.identitySource,
    usernameDraftValid,
  });

  useEffect(() => {
    if (!account.profileId || hydratedFor.current === account.profileId) return;
    hydratedFor.current = account.profileId;
    const lesson = readCurrentLesson(window.localStorage, account.profileId);
    dispatch({
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
        setIdentityError(
          error instanceof Error ? error.message : "Could not save that username.",
        );
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    dispatch({ type: "next" });
  };

  const finish = async (href: string) => {
    setSaving(true);
    try {
      if (account.needsOnboarding) await account.completeOnboarding();
      if (account.profileId) {
        clearCurrentLesson(window.localStorage, account.profileId);
      }
      router.replace(href);
    } catch (error) {
      setIdentityError(
        error instanceof Error ? error.message : "Could not finish onboarding.",
      );
      setSaving(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div
          className="absolute -right-48 -top-64 h-[620px] w-[680px] rounded-full opacity-45 blur-[110px]"
          style={{ background: "var(--pt-grad-dawn)" }}
        />
        <div
          className="absolute -bottom-72 -left-48 h-[560px] w-[620px] rounded-full opacity-20 blur-[110px]"
          style={{ background: "var(--pt-grad-dusk)" }}
        />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-12">
        <header className="flex items-center justify-between gap-4">
          <Image
            src="/brand/conviction-lockup.svg"
            alt="Conviction"
            width={145}
            height={37}
            className="h-9 w-auto"
            priority
          />
          <span className="rounded-full border border-warning/30 bg-[#fff5df] px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.09em] text-[#8c5b0f]">
            Practice only—no funds move
          </span>
        </header>

        <div
          className="mt-6"
          aria-label={`Onboarding progress: step ${state.step + 1} of ${ONBOARDING_STEPS.length}`}
        >
          <div className="flex items-center justify-between text-[11px] font-bold text-ink-3">
            <span>
              Step {state.step + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span>{onboardingProgress(state.step)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${onboardingProgress(state.step)}%` }}
            />
          </div>
        </div>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:gap-16 lg:py-10">
          <div className="max-w-lg">
            <p className="pt-eyebrow">
              {current === "identity" ? "Welcome to Conviction" : "Practice lesson"}
            </p>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-3 font-display text-[clamp(3rem,6vw,5.6rem)] font-medium leading-[0.92] tracking-[-0.045em] outline-none"
            >
              {title}
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-2 sm:text-lg">
              {description}
            </p>
            {state.step > 0 && state.step < ONBOARDING_STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => void finish("/")}
                disabled={saving}
                className="mt-6 text-sm font-bold text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50"
              >
                Skip tour
              </button>
            )}
          </div>

          <div className="min-h-[390px] rounded-[32px] border border-line bg-surface/75 p-5 shadow-lg backdrop-blur-xl sm:p-8 lg:p-10">
            {current === "identity" && (
              <IdentityStep
                identitySource={account.identitySource}
                handle={account.handle}
                email={account.email}
                username={username}
                setUsername={setUsername}
                setIdentityError={setIdentityError}
                identityError={identityError}
              />
            )}
            {current === "account" && <AccountStep />}
            {current === "deck" && (
              <DeckStep
                state={state}
                onGesture={(gesture) => dispatch({ type: "deck", gesture })}
              />
            )}
            {current === "ask" && (
              <AskStep
                answered={state.askAnswered}
                onAsk={() => dispatch({ type: "ask" })}
              />
            )}
            {current === "trade" && (
              <TradeStep
                state={state}
                onSize={(size) => dispatch({ type: "trade-size", size })}
                onPhase={(phase) => dispatch({ type: "trade-phase", phase })}
              />
            )}
            {current === "conviction" && (
              <ConvictionStep
                handle={account.handle}
                draft={draft}
                setDraft={setDraft}
                previewed={state.convictionPreviewed}
                onPreview={() => dispatch({ type: "conviction-preview" })}
              />
            )}
            {current === "ready" && (
              <ReadyStep
                handle={account.handle}
                identityError={identityError}
                saving={saving}
                finish={finish}
              />
            )}
          </div>
        </section>

        {current !== "ready" && (
          <footer className="flex items-center justify-between gap-3 border-t border-line py-4">
            <button
              type="button"
              onClick={() => dispatch({ type: "back" })}
              disabled={state.step === 0 || saving}
              className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-bold disabled:invisible"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void next()}
              disabled={!continueEnabled || saving}
              className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-brand-on disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Continue"}
            </button>
          </footer>
        )}
      </div>
    </main>
  );
}

export function OnboardingExperience() {
  return (
    <AccountGate mode="onboarding">
      <OnboardingTour />
    </AccountGate>
  );
}
