"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account/account-context";
import { LandingPage } from "@/components/landing/landing-page";
import { resolveAccountGate } from "@/lib/account-gate";
import { IS_LIVE } from "@/lib/env";

function ProfileFailure() {
  const account = useAccount();
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 text-center text-ink">
      <div className="max-w-md rounded-[28px] border border-line bg-surface p-8 shadow-md">
        <p className="pt-eyebrow">Profile unavailable</p>
        <h1 className="mt-3 font-display text-3xl font-semibold">
          We couldn&apos;t open your account.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-3">
          {account.profileError}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => void account.retryProfile()}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-brand-on"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={account.logout}
            className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-bold"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}

function QuietCanvas() {
  return <div className="min-h-screen bg-canvas" aria-busy="true" />;
}

export function AccountGate({
  mode,
  children,
}: {
  mode: "app" | "onboarding";
  children: React.ReactNode;
}) {
  const account = useAccount();
  const router = useRouter();
  const status = resolveAccountGate(
    {
      ready: account.ready,
      authenticated: account.authenticated,
      profileReady: account.profileReady,
      profileError: account.profileError,
      needsOnboarding: account.needsOnboarding,
    },
    mode,
    IS_LIVE,
  );

  useEffect(() => {
    if (status === "redirectOnboarding") {
      router.replace("/onboarding");
    }
  }, [router, status]);

  switch (status) {
    case "loading":
    case "redirectOnboarding":
      return <QuietCanvas />;
    case "signedOut":
      return <LandingPage />;
    case "profileError":
      return <ProfileFailure />;
    case "ready":
      return children;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
