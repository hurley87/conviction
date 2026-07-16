import Link from "next/link";
import type { ReactNode } from "react";

const FOOTER_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

export function ContentPage({
  eyebrow,
  title,
  intro,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5 sm:px-8">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-ink"
          >
            Conviction
          </Link>
          <Link
            href="/"
            className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-bold text-ink shadow-sm transition hover:border-brand hover:text-brand"
          >
            Open app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14 sm:px-8 sm:py-20">
        <div className="mb-12 border-b border-line pb-10">
          <p className="pt-eyebrow mb-4">{eyebrow}</p>
          <h1 className="max-w-2xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-ink sm:text-6xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink-2">{intro}</p>
          {updated ? (
            <p className="mt-5 font-mono text-xs text-ink-3">
              Last updated {updated}
            </p>
          ) : null}
        </div>

        <article className="space-y-10">{children}</article>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© {new Date().getFullYear()} Conviction</p>
          <nav className="flex gap-5" aria-label="Footer">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-semibold transition hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function ContentSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-3xl font-medium tracking-tight text-ink">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-base leading-7 text-ink-2">
        {children}
      </div>
    </section>
  );
}
