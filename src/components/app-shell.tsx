"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { AccountGate } from "@/components/account/account-gate";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarWallet } from "@/components/sidebar-wallet";
import { UserMenu } from "@/components/user-menu";
import {
  ConciergeBubble,
  ConciergeBubbleProvider,
} from "@/components/concierge-bubble";
import { UpgradeBeatHost } from "@/components/upgrade-beat-host";

const ROUTE_META: Record<string, { eyebrow: string; title: string }> = {
  "/": { eyebrow: "Today’s ritual", title: "The daily deck" },
  "/home": { eyebrow: "Your money", title: "Portfolio" },
  "/discover": { eyebrow: "Curated across crypto", title: "Discover" },
  "/activity": { eyebrow: "Your trail", title: "Activity" },
  "/settings": { eyebrow: "Your space", title: "Settings" },
};

function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const routeMeta =
    ROUTE_META[
      Object.keys(ROUTE_META).find((route) =>
        route === "/" ? pathname === "/" : pathname.startsWith(route),
      ) ?? "/"
    ];

  return (
    <ConciergeBubbleProvider>
      <div className="relative flex min-h-screen overflow-x-clip bg-canvas text-ink">
        <div
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
          aria-hidden
        >
          <div
            className="absolute -right-52 -top-72 h-[650px] w-[760px] rounded-full opacity-45 blur-[110px]"
            style={{ background: "var(--pt-grad-dawn)" }}
          />
          <div
            className="absolute -bottom-80 -left-60 h-[650px] w-[680px] rounded-full opacity-15 blur-[120px]"
            style={{ background: "var(--pt-grad-dusk)" }}
          />
          <div className="app-grain absolute inset-0 opacity-40" />
        </div>

        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-line bg-canvas/80 px-4 pb-4 pt-6 backdrop-blur-2xl lg:flex">
          <div className="flex items-center px-2 pb-8">
            <Image
              src="/brand/conviction-lockup.svg"
              alt="Conviction"
              width={151}
              height={38}
              priority
              className="h-[38px] w-auto"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            <p className="px-3 pb-3 text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-4">
              Your Conviction
            </p>
            <SidebarNav mode="desktop" />
          </div>

          <SidebarWallet />

          <div>
            <UserMenu />
          </div>
        </aside>

        <div className="relative z-10 flex min-h-screen min-w-0 flex-1 flex-col lg:ml-[264px]">
          <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-line bg-canvas/82 px-5 backdrop-blur-2xl sm:px-7 lg:hidden">
            <Image
              src="/brand/conviction-lockup.svg"
              alt="Conviction"
              width={132}
              height={34}
              priority
              className="h-8 w-auto"
            />
            <UserMenu compact />
          </header>

          <div className="hidden items-center px-10 pb-2 pt-7 lg:flex xl:px-14">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-4">
                {routeMeta.eyebrow}
              </p>
              <p className="mt-1 font-display text-[17px] font-semibold text-ink-2">
                {routeMeta.title}
              </p>
            </div>
          </div>

          <main className="flex-1 px-5 pb-28 pt-7 sm:px-7 lg:px-10 lg:pb-12 lg:pt-5 xl:px-14">
            <div key={pathname} className="app-enter">
              {children}
            </div>
          </main>

          <nav className="fixed inset-x-3 bottom-3 z-40 rounded-[24px] border border-line bg-surface/90 px-2 py-2 shadow-lg backdrop-blur-2xl lg:hidden">
            <SidebarNav mode="mobile" />
          </nav>
        </div>

        <ConciergeBubble />
        <UpgradeBeatHost />
      </div>
    </ConciergeBubbleProvider>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AccountGate mode="app">
      <AppShellChrome>{children}</AppShellChrome>
    </AccountGate>
  );
}
