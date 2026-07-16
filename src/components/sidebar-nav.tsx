"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Deck",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="4" y="5" width="16" height="12" rx="2" />
        <path d="M7 20h10M6.5 2.5h11" />
      </svg>
    ),
  },
  {
    href: "/home",
    label: "Portfolio",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19V3" />
      </svg>
    ),
  },
  {
    href: "/discover",
    label: "Discover",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
      </svg>
    ),
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  mode = "desktop",
}: {
  mode?: "desktop" | "mobile";
}) {
  const pathname = usePathname();

  return (
    <div
      className={
        mode === "mobile"
          ? "grid grid-cols-5 gap-1"
          : "flex flex-col gap-1.5"
      }
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              mode === "mobile"
                ? `flex min-w-0 flex-col items-center gap-1 rounded-[17px] px-1 py-2 text-[10px] font-bold transition ${
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-ink-3 hover:bg-surface-2 hover:text-ink"
                  }`
                : `group relative flex items-center gap-3 rounded-[17px] px-3 py-3 text-sm transition ${
                    active
                      ? "bg-surface font-extrabold text-ink shadow-sm"
                      : "font-bold text-ink-3 hover:bg-surface/65 hover:text-ink"
                  }`
            }
          >
            {mode === "desktop" && active && (
              <span className="absolute -left-1 h-7 w-1 rounded-full bg-brand" />
            )}
            <span
              className={
                active
                  ? mode === "mobile"
                    ? "text-brand"
                    : "text-ink"
                  : "text-ink-3 transition-transform group-hover:scale-105"
              }
            >
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
            {mode === "desktop" && item.href === "/" && (
              <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.08em] text-brand">
                Today
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
