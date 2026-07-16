"use client";

import { useRef, useState } from "react";
import { useAccount } from "@/components/account/account-context";
import { ActionDialog } from "@/components/home/action-dialog";
import { DepositDialogContent } from "@/components/home/wallet-action-dialogs";
import { formatUsd } from "@/lib/format";

type FundingView = "closed" | "choose" | "deposit";

export function SidebarWallet() {
  const account = useAccount();
  const [fundingView, setFundingView] = useState<FundingView>("closed");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshingRef = useRef(false);

  const balance = account.balance?.totalUsd ?? null;
  const isLoading = balance == null;
  const isFunded = balance != null && balance > 0;

  const openFunding = () => {
    if (account.isFunding) return;
    setRefreshError(null);
    setFundingView("choose");
  };

  const addWithCard = async () => {
    if (account.isFunding) return;
    setFundingView("closed");
    await account.addMoney();
  };

  const refreshBalance = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await account.refreshBalance();
    } catch {
      setRefreshError("Could not refresh your balance.");
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };

  return (
    <>
      <section
        className="mx-1 mb-3 rounded-[22px] border border-line bg-surface-3/85 p-4 shadow-sm"
        aria-label="Wallet balance"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {isLoading ? (
              <div
                className="h-7 w-20 animate-pulse rounded-lg bg-surface/75"
                aria-label="Loading wallet balance"
              />
            ) : (
              <p className="whitespace-nowrap text-[clamp(1.1rem,1.65vw,1.3rem)] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-ink">
                {formatUsd(balance)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={openFunding}
              disabled={account.isFunding}
              aria-label="Fund wallet"
              aria-haspopup="dialog"
              className="grid h-8 w-8 place-items-center rounded-full text-[24px] font-light leading-none text-ink-3 transition hover:bg-surface/70 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              <span aria-hidden className="-translate-y-px">
                +
              </span>
            </button>
            <button
              type="button"
              onClick={() => void refreshBalance()}
              disabled={refreshing}
              aria-label="Refresh wallet balance"
              title="Refresh balance"
              className="grid h-8 w-8 place-items-center rounded-full text-[18px] font-light leading-none text-ink-3 transition hover:bg-surface/70 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              <span aria-hidden className={refreshing ? "animate-spin" : ""}>
                ↻
              </span>
            </button>
          </div>
        </div>

        <p className="mt-2.5 text-[13px] leading-snug text-ink-3">
          {isFunded ? "Available to trade" : "Fund your wallet to start trading"}
        </p>

        <button
          type="button"
          onClick={openFunding}
          disabled={account.isFunding}
          aria-haspopup="dialog"
          className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-full bg-surface px-4 py-2.5 text-sm font-extrabold text-ink shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
        >
          <span
            aria-hidden
            className="relative block h-4 w-[18px] rounded-[3px] border-2 border-current"
          >
            <span className="absolute -right-1 top-1 h-1.5 w-1.5 rounded-full border border-current bg-surface" />
          </span>
          {account.isFunding ? "Opening funding…" : "Fund Wallet"}
        </button>

        {(account.fundingError || refreshError) && (
          <p className="mt-3 text-xs leading-relaxed text-danger" role="alert">
            {refreshError ?? account.fundingError}
          </p>
        )}
      </section>

      {fundingView !== "closed" && (
        <ActionDialog
          title={fundingView === "deposit" ? "Deposit crypto" : "Fund Wallet"}
          description={
            fundingView === "deposit"
              ? "Send supported USDC to your Universal Account."
              : "Choose how you want to add funds."
          }
          onClose={() => setFundingView("closed")}
        >
          {fundingView === "choose" ? (
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => void addWithCard()}
                disabled={account.isFunding}
                className="group flex items-center gap-4 rounded-[20px] border border-line bg-surface-2/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-xl font-bold text-brand-on">
                  $
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-ink">
                    Add with card
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-3">
                    Buy USDC through the secure card funding flow.
                  </span>
                </span>
                <span
                  aria-hidden
                  className="text-xl text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink"
                >
                  ›
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFundingView("deposit")}
                className="group flex items-center gap-4 rounded-[20px] border border-line bg-surface-2/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2 hover:shadow-sm"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-soft text-2xl font-light text-brand">
                  ↓
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-ink">
                    Deposit crypto
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-3">
                    Copy an address or scan a QR code from another wallet.
                  </span>
                </span>
                <span
                  aria-hidden
                  className="text-xl text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink"
                >
                  ›
                </span>
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setFundingView("choose")}
                className="mb-5 text-sm font-bold text-ink-3 transition hover:text-ink"
              >
                ← Funding options
              </button>
              <DepositDialogContent deposits={account.deposits} />
            </div>
          )}
        </ActionDialog>
      )}
    </>
  );
}
