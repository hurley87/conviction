"use client";

import { useCallback, useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { ActionDialog } from "@/components/home/action-dialog";
import { TradeDialogContent } from "@/components/home/trade-dialog";
import {
  DepositDialogContent,
  ReceiveDialogContent,
} from "@/components/home/wallet-action-dialogs";
import { WithdrawalHost } from "@/components/settings/withdrawal-host";

type QuickAction = "trade" | "send" | "receive" | "deposit";

const ACTIONS: {
  id: QuickAction;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "trade",
    label: "Trade",
    description:
      "Choose what to receive and pay from your unified balance.",
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
    description:
      "Send a supported asset to an external wallet after reviewing the quote.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m22 2-7 20-4-9-9-4Z" />
      </svg>
    ),
  },
  {
    id: "receive",
    label: "Receive",
    description:
      "Create clear USDC payment instructions to copy or share.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    ),
  },
  {
    id: "deposit",
    label: "Deposit",
    description:
      "Send USDC from another wallet to your Universal Account.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
];

export function QuickActions() {
  const account = useAccount();
  const [active, setActive] = useState<QuickAction | null>(null);
  const [locked, setLocked] = useState(false);
  const onBusyChange = useCallback((busy: boolean) => setLocked(busy), []);
  const close = useCallback(() => {
    setActive(null);
    setLocked(false);
  }, []);
  const activeAction = ACTIONS.find((action) => action.id === active);

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ACTIONS.map((action) => {
          const primary = action.id === "trade";
          return (
            <button
              key={action.id}
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setLocked(false);
                setActive(action.id);
              }}
              className={`group flex items-center gap-3 rounded-[20px] border px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:flex-col sm:justify-center sm:gap-2 sm:px-3 sm:py-[18px] sm:text-center ${
                primary
                  ? "border-brand bg-brand text-brand-on hover:bg-brand-hover"
                  : "border-line bg-surface/70 text-ink hover:border-line-strong hover:bg-surface"
              }`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-transform group-hover:scale-105 ${
                  primary ? "bg-white/12" : "bg-brand-soft text-brand"
                }`}
              >
                {action.icon}
              </span>
              <span className="text-[13px] font-bold">{action.label}</span>
            </button>
          );
        })}
      </div>

      {activeAction && (
        <ActionDialog
          title={activeAction.label}
          description={activeAction.description}
          dismissible={!locked}
          onClose={close}
        >
          {active === "trade" && (
            <TradeDialogContent
              onClose={close}
              onBusyChange={onBusyChange}
            />
          )}
          {active === "send" && (
            <WithdrawalHost
              onClose={close}
              embedded
              onBusyChange={onBusyChange}
            />
          )}
          {active === "receive" && (
            <ReceiveDialogContent deposits={account.deposits} />
          )}
          {active === "deposit" && (
            <DepositDialogContent deposits={account.deposits} />
          )}
        </ActionDialog>
      )}
    </div>
  );
}
