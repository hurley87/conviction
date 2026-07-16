"use client";

// Onboarding is Twitter social login only (ADR 0004): one tap mints an embedded
// EOA we 7702-upgrade in place — no MetaMask/seed-phrase path, to keep the
// product consumer-grade. When no app id is set, we pass through so the app
// still runs locally against the mock (ADR 0014).

import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID } from "@/lib/env";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["twitter"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "light",
          accentColor: "#4B2A52",
          logo: "/brand/conviction-mark.png",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
