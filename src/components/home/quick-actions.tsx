"use client";

import { useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { useConciergeBubble } from "@/components/concierge-bubble";
import { DepositAddress } from "@/components/deposit-address";
import { PRIMARY_LIGHT } from "@/components/button-styles";

type QuickAction = "trade" | "send" | "receive" | "deposit";

const ACTIONS: { id: QuickAction; label: string; icon: React.ReactNode }[] = [
  {
    id: "trade",
    label: "Trade",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M17 1l4 4-4 4" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <path d="M7 23l-4-4 4-4" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  {
    id: "send",
    label: "Send",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m22 2-7 20-4-9-9-4Z" />
      </svg>
    ),
  },
  {
    id: "receive",
    label: "Receive",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    ),
  },
  {
    id: "deposit",
    label: "Deposit",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
];

export function QuickActions() {
  const account = useAccount();
  const { openBubble } = useConciergeBubble();
  const [active, setActive] = useState<QuickAction | null>(null);

  return (
    <div className="w-full">
      <div className="grid grid-cols-4 gap-3">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              if (action.id === "trade") {
                openBubble();
                return;
              }
              if (action.id === "deposit") {
                void account.addMoney();
                return;
              }
              setActive(action.id);
            }}
            disabled={action.id === "deposit" && account.isFunding}
            className="flex flex-col items-center gap-2 rounded-2xl bg-blue-50 px-5 py-4 text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
          >
            <span className="text-blue-600">{action.icon}</span>
            <span className="text-sm font-semibold">{action.label}</span>
          </button>
        ))}
      </div>

      {account.fundingError && (
        <p className="mt-3 text-center text-xs text-red-500">{account.fundingError}</p>
      )}

      {active === "receive" && account.deposits && (
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="mb-4 text-center text-sm font-medium text-zinc-700">
            Send assets to your wallet
          </p>
          <DepositAddress deposits={account.deposits} />
          <button
            type="button"
            onClick={() => setActive(null)}
            className="mt-4 w-full text-sm text-zinc-500 hover:text-zinc-700"
          >
            Close
          </button>
        </div>
      )}

      {active === "send" && (
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 text-center">
          <p className="text-sm text-zinc-600">
            Send is coming soon. Use Trade to move funds between assets for now.
          </p>
          <button
            type="button"
            onClick={() => setActive(null)}
            className={`${PRIMARY_LIGHT} mt-4 px-6 py-2 text-sm`}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
