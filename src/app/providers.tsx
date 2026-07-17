"use client";

// Email OTP and X login both create the same embedded EOA. When no app id is
// set, pass through so local development keeps using the zero-credential mock.

import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID } from "@/lib/env";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "twitter"],
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
