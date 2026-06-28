"use client";

// Onboarding is Twitter social login only (ADR 0004): one tap mints an embedded
// EOA we 7702-upgrade in place — no MetaMask/seed-phrase path, to keep the
// product consumer-grade. When no app id is set, we pass through so the app
// still runs locally against the mock (ADR 0014).

import { PrivyProvider } from "@privy-io/react-auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter"],
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
