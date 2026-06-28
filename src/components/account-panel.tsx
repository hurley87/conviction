"use client";

// Picks the live or mock onboarding panel based on whether Privy is configured.
// The choice is fixed per build (a NEXT_PUBLIC_ flag is inlined at build time),
// so the live Privy hooks only ever run when the provider is present.

import { LiveAccount } from "@/components/live-account";
import { MockAccount } from "@/components/mock-account";

const LIVE = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

export function AccountPanel() {
  return LIVE ? <LiveAccount /> : <MockAccount />;
}
