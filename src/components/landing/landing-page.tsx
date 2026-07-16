"use client";

// Unauthenticated landing (design 7a — "Landing · one promise, one way in").
// gg.xyz's ethos — publish the thesis, not the trade — rendered in Conviction's
// warm, quiet register: one serif promise, one plum way in, one honest sample
// of the product. Every CTA drops the visitor into the Twitter sign-in flow.

import { useState } from "react";
import { useAccount } from "@/components/account/account-context";

const STEPS = [
  {
    n: "1",
    tint: "var(--pt-mood-calm)",
    title: "Read the why",
    body: "Every call opens with a thesis, not a ticker. You judge the reasoning before the position.",
  },
  {
    n: "2",
    tint: "var(--pt-mood-joyful)",
    title: "Back what you believe",
    body: "Put a real, self-sized stake behind a conviction — a fraction of your balance, never a blind copy.",
  },
  {
    n: "3",
    tint: "var(--pt-mood-sad)",
    title: "Watch it play out",
    body: "Follow the position in the open. Green or red, every call compounds into a public track record.",
  },
  {
    n: "4",
    tint: "var(--pt-mood-tired)",
    title: "Learn from the receipt",
    body: "When it settles, the receipt shows the full picture — what worked, what didn't, and who was really behind the call.",
  },
];

const FAQS = [
  {
    q: 'What does it mean to "back" a conviction?',
    a: "You put a real, self-sized stake behind someone's thesis — a fraction of your balance you choose, never a blind mirror of their whole wallet. If you believe the reasoning, you back it; if not, you don't.",
  },
  {
    q: "Do I need crypto to start?",
    a: "No. Sign in with Twitter and add funds with a card — Conviction spins up a wallet for you behind the scenes. You never touch a seed phrase.",
  },
  {
    q: "Which chains does it work across?",
    a: "Solana, Base, and Arbitrum settle from one unified balance. Particle Network's Universal Accounts handle the bridging, so you back a conviction without thinking about which chain it lives on.",
  },
  {
    q: "How is this different from copy-trading?",
    a: "Copy-trading mirrors a wallet blindly. Here you read the thesis first and choose your own size — the reasoning is the product, and you only stake what you actually believe.",
  },
  {
    q: "Can I post my own convictions?",
    a: "Yes. Share the position and the why behind it. Every call you post builds a public, on-chain track record that plays out green or red for everyone to see.",
  },
];

export function LandingPage() {
  const { login } = useAccount();
  const [openFaq, setOpenFaq] = useState(0);

  // Smooth in-page jumps for the nav/footer anchors. Handled in JS rather than
  // global `scroll-behavior` so it stays scoped to the landing.
  const scrollTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="pt-page relative flex min-h-screen flex-col bg-canvas">
      {/* Warm hero blobs — clipped by their own wrapper so the scrolling root
          never becomes an `overflow:hidden` scroll trap (breaks Safari). */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute -right-[120px] -top-[220px] h-[520px] w-[680px] rounded-full opacity-50 blur-[100px]"
          style={{ background: "var(--pt-grad-dawn)" }}
        />
        <div
          className="absolute -bottom-[260px] -left-[160px] h-[480px] w-[620px] rounded-full opacity-[0.28] blur-[110px]"
          style={{ background: "var(--pt-grad-dusk)" }}
        />
      </div>

      {/* Nav */}
      <header className="relative flex items-center justify-between px-6 py-6 sm:px-11">
        <div className="font-display text-[22px] font-semibold text-ink">
          Conviction
        </div>
        <nav className="flex items-center gap-5 text-sm font-semibold text-ink-3 sm:gap-7">
          <a
            href="#how-it-works"
            onClick={scrollTo("how-it-works")}
            className="hidden hover:text-ink sm:inline"
          >
            How it works
          </a>
          <a
            href="#faq"
            onClick={scrollTo("faq")}
            className="hidden hover:text-ink sm:inline"
          >
            FAQ
          </a>
          <button
            type="button"
            onClick={login}
            className="rounded-full bg-surface px-5 py-2.5 font-bold text-ink shadow-sm transition hover:shadow-md"
          >
            Sign in
          </button>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative mx-auto grid w-full max-w-[1180px] items-center gap-12 px-6 pb-16 pt-5 sm:px-11 lg:grid-cols-[1fr_420px]">
        <div className="flex max-w-[540px] flex-col gap-6">
          <h1 className="font-display text-5xl font-medium leading-[1.02] tracking-[-0.025em] text-ink text-balance sm:text-6xl">
            Trade with conviction.
          </h1>
          <p className="max-w-[460px] text-lg leading-relaxed text-ink-2">
            Every position comes with the{" "}
            <i className="font-display">why</i>. Read real theses, back the ones
            you believe, and learn from the calls that played out — the
            reasoning is the product, not the trade.
          </p>
          <div className="mt-1">
            <button
              type="button"
              onClick={login}
              className="rounded-full bg-brand px-8 py-4 text-[15px] font-bold text-brand-on shadow-md transition hover:bg-brand-hover"
            >
              Sign up
            </button>
          </div>
        </div>

        {/* Sample conviction card */}
        <div className="relative">
          <div
            className="absolute -bottom-3 -left-2.5 -right-2.5 top-3.5 rounded-[var(--pt-radius-xl)] bg-surface opacity-70 shadow-sm"
            style={{ transform: "rotate(1.5deg)" }}
            aria-hidden
          />
          <div className="relative flex flex-col gap-3.5 rounded-[var(--pt-radius-xl)] bg-surface px-6 py-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div
                className="grid h-[38px] w-[38px] place-items-center rounded-full text-sm font-bold text-ink"
                style={{ background: "var(--pt-mood-sad)" }}
              >
                N
              </div>
              <div>
                <div className="text-sm font-bold text-ink">@nadiafx</div>
                <div className="text-xs text-ink-4">
                  71% resolved green · 8 convictions
                </div>
              </div>
              <span
                className="ml-auto rounded-full px-3.5 py-1.5 text-xs font-bold text-ink"
                style={{ background: "var(--pt-mood-calm)" }}
              >
                Long ETH
              </span>
            </div>
            <p className="font-display text-[18px] italic leading-[1.55] text-ink">
              &ldquo;ETF flows haven&rsquo;t priced in the staking approval.
              Sized at 4% — slow thesis, quarter-long horizon.&rdquo;
            </p>
            <div className="flex items-center gap-4 border-t border-line pt-2 text-[13px] text-ink-3">
              <span className="font-bold text-success">+6.2% since posted</span>
              <span>34 backers</span>
              <button
                type="button"
                onClick={login}
                className="ml-auto rounded-full bg-brand px-5 py-2 text-[13px] font-bold text-brand-on transition hover:bg-brand-hover"
              >
                Back
              </button>
            </div>
          </div>
          <div className="mt-5 text-center text-xs text-ink-4">
            A real conviction from the feed.
          </div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-6 pb-16 sm:px-11"
      >
        <div className="flex max-w-[520px] flex-col gap-2.5">
          <span className="pt-eyebrow">How it works</span>
          <h2 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            From thesis to receipt.
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="flex flex-col gap-3 rounded-[var(--pt-radius-lg)] bg-surface px-5 py-6 shadow-sm"
            >
              <div
                className="grid h-10 w-10 place-items-center rounded-full font-display text-base font-semibold text-ink"
                style={{ background: step.tint }}
              >
                {step.n}
              </div>
              <div className="text-[15px] font-bold text-ink">{step.title}</div>
              <p className="text-[13px] leading-[1.55] text-ink-3">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="relative mx-auto grid w-full max-w-[1180px] items-start gap-12 px-6 pb-20 sm:px-11 lg:grid-cols-[340px_1fr]"
      >
        <div className="flex flex-col gap-3">
          <span className="pt-eyebrow">FAQ</span>
          <h2 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            Questions, answered plainly.
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-3">
            Everything about backing, posting, and what happens on-chain.
          </p>
        </div>

        <div className="flex flex-col">
          {FAQS.map((faq, i) => {
            const open = openFaq === i;
            return (
              <div key={faq.q} className="flex flex-col border-t border-line">
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? -1 : i)}
                  aria-expanded={open}
                  className="flex items-center gap-4 py-5 text-left"
                >
                  <span className="flex-1 text-base font-bold text-ink">
                    {faq.q}
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-ink-3"
                    aria-hidden
                  >
                    {open ? (
                      <path d="M5 12h14" />
                    ) : (
                      <path d="M12 5v14M5 12h14" />
                    )}
                  </svg>
                </button>
                {open && (
                  <p className="max-w-[560px] pb-5 text-sm leading-relaxed text-ink-3">
                    {faq.a}
                  </p>
                )}
              </div>
            );
          })}
          <div className="border-t border-line" />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative flex flex-col gap-10 border-t border-line bg-surface px-6 pb-9 pt-13 sm:px-11">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div className="flex max-w-[300px] flex-col gap-3.5">
            <div className="font-display text-[22px] font-semibold text-ink">
              Conviction
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink-3">
              Thesis-driven trading. Read the why, back what you believe, learn
              from every receipt.
            </p>
            <div className="mt-1 flex gap-2.5">
              <span
                className="grid h-[34px] w-[34px] place-items-center rounded-full bg-canvas"
                aria-hidden
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--pt-fg-2)">
                  <path d="M18.9 2H22l-7.2 8.3L23.3 22h-6.6l-5.2-6.8L5.6 22H2.5l7.7-8.9L1 2h6.8l4.7 6.2L18.9 2Zm-1.1 18h1.8L7.3 3.8H5.4L17.8 20Z" />
                </svg>
              </span>
            </div>
          </div>
          <nav className="flex flex-wrap gap-7 text-[13.5px] text-ink-3">
            <a
              href="#how-it-works"
              onClick={scrollTo("how-it-works")}
              className="hover:text-ink"
            >
              How it works
            </a>
            <a href="#faq" onClick={scrollTo("faq")} className="hover:text-ink">
              FAQ
            </a>
            <span>Docs</span>
            <span>Terms</span>
            <span>Privacy</span>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <span className="text-[12.5px] text-ink-4">© 2026 Conviction</span>
          <span className="ml-auto max-w-[520px] text-right text-[11.5px] leading-relaxed text-ink-4">
            Nothing here is financial advice. Convictions are community views;
            you trade at your own risk.
          </span>
        </div>
      </footer>
    </div>
  );
}
