"use client";

// Privy is the sole wallet provider for both onboarding paths (ADR 0004):
// "sign in with Twitter" mints/links an embedded EOA, and existing wallets
// connect — both yield an EOA we then 7702-upgrade. When no app id is set, we
// pass through so the app still runs locally against the mock (ADR 0014).

import { PrivyProvider } from "@privy-io/react-auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#6C7BFF",
          logo: "/logo.png",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
