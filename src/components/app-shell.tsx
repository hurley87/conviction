"use client";

import { SidebarNav } from "@/components/sidebar-nav";
import { UserMenu } from "@/components/user-menu";
import {
  ConciergeBubble,
  ConciergeBubbleProvider,
} from "@/components/concierge-bubble";
import { UpgradeBeatHost } from "@/components/upgrade-beat-host";
import { useAccount } from "@/components/account/account-context";
import { LandingPage } from "@/components/landing/landing-page";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = useAccount();

  // Logged-out visitors get the marketing landing instead of the app chrome;
  // hold on a quiet canvas until Privy resolves so the deck never flashes.
  if (!ready) {
    return <div className="min-h-screen bg-canvas" />;
  }
  if (!authenticated) {
    return <LandingPage />;
  }

  return (
    <ConciergeBubbleProvider>
      <div className="flex min-h-screen bg-canvas text-ink">
        <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-line bg-canvas">
          <div className="flex items-center px-4 pb-5 pt-6">
            <span className="font-display text-xl font-semibold tracking-tight text-ink">
              Conviction
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            <SidebarNav />
          </div>
          <div className="p-3">
            <UserMenu />
          </div>
        </aside>

        <div className="ml-56 flex min-h-screen flex-1 flex-col">
          <main className="flex-1 px-8 py-8">{children}</main>
        </div>

        <ConciergeBubble />
        <UpgradeBeatHost />
      </div>
    </ConciergeBubbleProvider>
  );
}
