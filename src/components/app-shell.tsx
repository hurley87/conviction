"use client";

import Image from "next/image";
import { SidebarNav } from "@/components/sidebar-nav";
import { UserMenu } from "@/components/user-menu";
import {
  ConciergeBubble,
  ConciergeBubbleProvider,
} from "@/components/concierge-bubble";
import { useAccount } from "@/components/account/account-context";
import { UpgradeBeat } from "@/components/upgrade-beat";

export function AppShell({ children }: { children: React.ReactNode }) {
  const account = useAccount();

  return (
    <ConciergeBubbleProvider>
      <div className="flex min-h-screen bg-white text-zinc-900">
        <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col bg-white">
          <div className="flex items-center gap-2.5 px-3 pb-4 pt-6">
            <Image
              src="/logo.png"
              alt="Conviction"
              width={32}
              height={32}
              className="rounded-lg"
              priority
            />
            <span className="text-xl font-bold tracking-tight text-zinc-900">
              Conviction
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            <SidebarNav />
          </div>
          <div className="border-t border-zinc-200 p-3">
            <UserMenu />
          </div>
        </aside>

        <div className="ml-56 flex min-h-screen flex-1 flex-col">
          <main className="flex-1 px-8 py-8">{children}</main>
        </div>

        <ConciergeBubble />

        {account.showUpgradeBeat && account.address && (
          <UpgradeBeat
            address={account.address}
            balanceUsd={account.balance?.totalUsd ?? null}
            onDismiss={account.dismissUpgradeBeat}
          />
        )}
      </div>
    </ConciergeBubbleProvider>
  );
}
