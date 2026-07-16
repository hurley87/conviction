"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account/account-context";
import styles from "./landing-page.module.css";

const CARD_ANATOMY = [
  {
    label: "The position",
    title: "Skin in the game",
    body: "The author opens the position before the card is published.",
    tint: "var(--pt-mood-calm)",
  },
  {
    label: "Why now",
    title: "Timing, not hype",
    body: "The events that made the idea worth acting on today.",
    tint: "var(--pt-mood-joyful)",
  },
  {
    label: "What breaks it",
    title: "A real falsifier",
    body: "The author tells you what would make the thesis wrong.",
    tint: "var(--pt-mood-sad)",
  },
  {
    label: "Gate report",
    title: "Facts before flow",
    body: "Liquidity, route, and position checks are made visible.",
    tint: "var(--pt-mood-tired)",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Discover what matters",
    body: "Conviction researches across crypto and narrows the market to a small, curated set of tokens.",
  },
  {
    n: "02",
    title: "Read their conviction",
    body: "See another trader’s revealed position, why they opened it, the risk, and what would make them wrong.",
  },
  {
    n: "03",
    title: "Make the call",
    body: "Skip what you don’t believe, save what you’re watching, or back it at your own size.",
  },
];

const SUPPORTED_NETWORKS = [
  { name: "Ethereum", short: "Ξ", color: "#627EEA" },
  { name: "Optimism", short: "OP", color: "#FF0420" },
  { name: "Arbitrum", short: "A", color: "#28A0F0" },
  { name: "Base", short: "B", color: "#0052FF" },
  { name: "BNB Chain", short: "BNB", color: "#F3BA2F" },
  { name: "Berachain", short: "BE", color: "#D69B43" },
  { name: "Sonic", short: "S", color: "#101010" },
  { name: "Polygon", short: "P", color: "#8247E5" },
  { name: "X Layer", short: "X", color: "#050505" },
  { name: "Solana", short: "≋", color: "#14F195" },
];

const FAQS = [
  {
    q: "How does Discover help me find new tokens?",
    a: "Crypto research is fragmented across chains, markets, and communities. Conviction does the broad discovery work and surfaces a small curated set of tokens through other people’s revealed positions. You can read their reasoning, see the risks and onchain checks, and decide what deserves a closer look.",
  },
  {
    q: 'What does it mean to "back" a conviction?',
    a: "You put a self-sized stake behind someone’s revealed position. You choose the fraction of your own balance, so you are backing the reasoning—not blindly matching their dollar amount.",
  },
  {
    q: "Is this just copy-trading?",
    a: "No. Traditional copy-trading asks you to mirror a wallet. Conviction starts with the thesis, shows what would make it wrong, and lets you decide whether the position deserves your capital.",
  },
  {
    q: "Do I need a crypto wallet to start?",
    a: "No. Sign in with X and Conviction creates your account behind the scenes. You can add money with a card without managing a seed phrase.",
  },
  {
    q: "What is a unified balance?",
    a: "It is one spendable dollar balance for the assets you hold across supported networks. You choose the position; Conviction handles the route. The receipt is there when you want to inspect the onchain details.",
  },
  {
    q: "Are convictions financial advice?",
    a: "No. A conviction is a disclosed position and its reasoning, not a recommendation. Markets are risky, every thesis can be wrong, and you remain responsible for every decision you make.",
  },
];

export function LandingPage() {
  const { login } = useAccount();
  const [openFaq, setOpenFaq] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const revealItems = Array.from(
      page.querySelectorAll<HTMLElement>(`.${styles.reveal}`),
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add(styles.revealVisible));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add(styles.revealVisible);
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -10% 0px",
        threshold: 0.12,
      },
    );

    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <div
      ref={pageRef}
      className="relative min-h-screen overflow-clip bg-canvas text-ink"
    >
      <div className={styles.ambient} aria-hidden>
        <div className={styles.ambientDawn} />
        <div className={styles.ambientDusk} />
        <div className={styles.grain} />
      </div>

      <header className="relative z-20 mx-auto flex w-full max-w-[1280px] items-center justify-between px-6 py-6 sm:px-10 lg:px-14">
        <a
          href="#top"
          onClick={scrollTo("top")}
          className="group flex items-center gap-3"
          aria-label="Conviction, back to top"
        >
          <span className={styles.logoMark} aria-hidden>
            <span>C</span>
          </span>
          <span className="font-display text-[23px] font-semibold tracking-[-0.02em] text-ink">
            Conviction
          </span>
        </a>

        <nav
          className="flex items-center gap-4 text-sm font-semibold text-ink-3 sm:gap-7"
          aria-label="Main navigation"
        >
          <a
            href="#discover"
            onClick={scrollTo("discover")}
            className="hidden transition-colors hover:text-ink md:inline"
          >
            Discover
          </a>
          <a
            href="#how-it-works"
            onClick={scrollTo("how-it-works")}
            className="hidden transition-colors hover:text-ink sm:inline"
          >
            How it works
          </a>
          <a
            href="#ai-agent"
            onClick={scrollTo("ai-agent")}
            className="hidden transition-colors hover:text-ink lg:inline"
          >
            AI agent
          </a>
          <button
            type="button"
            onClick={login}
            className="rounded-full border border-line-strong bg-surface/80 px-5 py-2.5 font-bold text-ink shadow-sm backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-surface hover:shadow-md"
          >
            Sign in
          </button>
        </nav>
      </header>

      <main id="top" className="relative">
        <section className="mx-auto grid min-h-[760px] w-full max-w-[1280px] items-center gap-16 px-6 pb-28 pt-14 sm:px-10 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] lg:px-14 lg:pb-36 lg:pt-24">
          <div className="relative z-10 max-w-[690px]">
            <div className={`${styles.fadeUp} flex items-center gap-3`}>
              <span className={styles.liveDot} aria-hidden />
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-3">
                Real people. Revealed positions. Curated across crypto.
              </span>
            </div>

            <h1
              className={`${styles.fadeUp} mt-7 font-display text-[clamp(4rem,8vw,7.5rem)] font-medium leading-[0.86] tracking-[-0.055em] text-ink`}
              style={{ animationDelay: "80ms" }}
            >
              Back the
              <br />
              <span className="italic text-brand">reasoning.</span>
              <br />
              Not the noise.
            </h1>

            <p
              className={`${styles.fadeUp} mt-8 max-w-[590px] text-lg leading-[1.7] text-ink-2 sm:text-xl`}
              style={{ animationDelay: "160ms" }}
            >
              It&apos;s impossible to research every token across every chain.
              Conviction does the discovery work and brings you a curated set
              through other people&apos;s revealed positions—their thesis,
              timing, risk, and actual stake—so you can decide what deserves
              your backing.
            </p>

            <div
              className={`${styles.fadeUp} mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center`}
              style={{ animationDelay: "240ms" }}
            >
              <button
                type="button"
                onClick={login}
                className="group inline-flex items-center gap-3 rounded-full bg-brand px-7 py-4 text-[15px] font-bold text-brand-on shadow-md transition hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-lg"
              >
                Open today&apos;s deck
                <span
                  className="transition-transform group-hover:translate-x-1"
                  aria-hidden
                >
                  →
                </span>
              </button>
              <a
                href="#discover"
                onClick={scrollTo("discover")}
                className="inline-flex items-center gap-2 px-2 py-3 text-sm font-bold text-ink-2 transition hover:text-ink"
              >
                See how discovery works
                <span aria-hidden>↓</span>
              </a>
            </div>

            <p
              className={`${styles.fadeUp} mt-7 text-xs leading-relaxed text-ink-4`}
              style={{ animationDelay: "320ms" }}
            >
              Sign in with X, or connect your existing wallet. Same address. No
              migration. You choose every position.
            </p>
          </div>

          <div className={`${styles.heroVisual} relative mx-auto w-full max-w-[520px]`}>
            <div className={styles.swipeLabelLeft} aria-hidden>
              Skip
            </div>
            <div className={styles.swipeLabelRight} aria-hidden>
              Back
            </div>

            <div className={styles.cardShadowTwo} aria-hidden />
            <div className={styles.cardShadowOne} aria-hidden />

            <article className={styles.heroCard}>
              <div className="flex items-start justify-between gap-5">
                <div className="flex items-center gap-3">
                  <div className={styles.avatar}>D</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-extrabold text-ink">
                        @davidbhurley
                      </span>
                      <span className={styles.deskBadge}>Desk</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-4">
                      Position opened before publish
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--pt-mood-calm)] px-3.5 py-1.5 text-xs font-extrabold text-ink">
                  Long ETH
                </span>
              </div>

              <div className="mt-7">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-4">
                  The thesis
                </p>
                <p className="mt-2 font-display text-[25px] italic leading-[1.35] text-ink">
                  “ETH looks clean into the next leg. A small long, with the
                  receipt published in the open.”
                </p>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <div className={styles.cardDetail}>
                  <span className={styles.detailDot} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink-4">
                      Why now
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">
                      Open interest rebuilt without a liquidation cascade.
                    </p>
                  </div>
                </div>
                <div className={styles.cardDetail}>
                  <span
                    className={styles.detailDot}
                    style={{ background: "var(--pt-mood-sad)" }}
                  />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink-4">
                      What breaks it
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">
                      A decisive break of the prior swing low.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                {["Liquidity passed", "Route passed", "Receipt attached"].map(
                  (check) => (
                    <span key={check} className={styles.checkChip}>
                      <span aria-hidden>✓</span>
                      {check}
                    </span>
                  ),
                )}
              </div>

              <div className="mt-7 flex items-center gap-4 border-t border-line pt-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">
                    Desk position
                  </p>
                  <p className="mt-0.5 font-display text-xl font-semibold text-ink">
                    $20
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">
                    You choose
                  </p>
                  <p className="mt-0.5 text-xs font-bold text-ink-2">
                    Your own size
                  </p>
                </div>
                <button
                  type="button"
                  onClick={login}
                  className="rounded-full bg-brand px-5 py-3 text-xs font-extrabold text-brand-on transition hover:bg-brand-hover"
                >
                  Back →
                </button>
              </div>
            </article>

            <div className={styles.floatingReceipt} aria-hidden>
              <span className={styles.receiptIcon}>✓</span>
              <span>
                <strong>Receipt verified</strong>
                <small>Position is onchain</small>
              </span>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-6 sm:px-10">
          <div className="grid border-y border-line py-7 sm:grid-cols-3">
            {[
              ["Cross-chain discovery", "We scan broadly. You get the shortlist."],
              ["Revealed convictions", "Read the people behind each position."],
              ["Research you can inspect", "Reasoning, risks, and onchain checks."],
            ].map(([title, body], index) => (
              <div
                key={title}
                className={`${styles.reveal} py-5 sm:px-8 sm:py-2 ${
                  index > 0 ? "border-t border-line sm:border-l sm:border-t-0" : ""
                }`}
                style={{ transitionDelay: `${index * 90}ms` }}
              >
                <p className="font-display text-xl font-semibold text-ink">
                  {title}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="discover"
          className="mx-auto w-full max-w-[1280px] px-6 py-32 sm:px-10 sm:py-40 lg:px-14"
        >
          <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,0.84fr)_minmax(500px,1.16fr)]">
            <div className={`${styles.reveal} max-w-[560px]`}>
              <span className="pt-eyebrow">Discover across crypto</span>
              <h2 className="mt-5 font-display text-[clamp(3rem,6vw,5.5rem)] font-medium leading-[0.95] tracking-[-0.045em] text-ink">
                Find the token.
                <br />
                Read the
                <br className="sm:hidden" />{" "}
                <span className="italic text-brand">conviction.</span>
              </h2>
              <p className="mt-7 max-w-[530px] text-base leading-[1.8] text-ink-2 sm:text-lg">
                Crypto discovery is fragmented by chain, venue, and community.
                No one can watch it all. Conviction researches across crypto,
                then lets you read the revealed positions of people who have
                already put capital behind an idea. You see what they believe,
                why they believe it, and what could prove them wrong.
              </p>
              <div className="mt-9 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-line bg-surface/75 p-5 shadow-sm">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-4">
                    Broad research
                  </span>
                  <p className="mt-3 font-display text-2xl font-semibold text-ink">
                    Across crypto
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">
                    Signals and tokens are considered across supported
                    ecosystems, not one chain at a time.
                  </p>
                </div>
                <div className="rounded-[22px] border border-line bg-surface/75 p-5 shadow-sm">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-ink-4">
                    Social conviction
                  </span>
                  <p className="mt-3 font-display text-2xl font-semibold text-ink">
                    People with a position
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-3">
                    Read what other traders backed, their reasoning, and the
                    risk they accepted before you make your own call.
                  </p>
                </div>
              </div>
            </div>

            <div
              className={`${styles.reveal} ${styles.revealScale} relative overflow-hidden rounded-[34px] border border-line bg-surface/88 p-5 shadow-lg backdrop-blur-xl sm:p-8`}
              style={{ transitionDelay: "120ms" }}
            >
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-55 blur-[70px]"
                style={{ background: "var(--pt-grad-dawn)" }}
                aria-hidden
              />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-4">
                      Conviction Discover
                    </p>
                    <p className="mt-2 font-display text-[30px] font-semibold leading-tight text-ink">
                      From the whole market
                      <br />
                      to what matters today.
                    </p>
                  </div>
                  <span className="rounded-full bg-brand-soft px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-brand">
                    Always researching
                  </span>
                </div>

                <div className="mt-8">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-4">
                    Looking across
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SUPPORTED_NETWORKS.slice(0, 8).map((network) => (
                      <span
                        key={network.name}
                        className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-2 shadow-sm"
                      >
                        <span
                          className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-extrabold"
                          style={{
                            background: network.color,
                            color:
                              network.name === "Solana" ||
                              network.name === "BNB Chain"
                                ? "#17101a"
                                : "#ffffff",
                          }}
                          aria-hidden
                        >
                          {network.short}
                        </span>
                        {network.name}
                      </span>
                    ))}
                    <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-3 py-2 text-xs font-extrabold text-brand">
                      + more
                    </span>
                  </div>
                </div>

                <div className="my-7 flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm text-brand-on shadow-md">
                    ↓
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>

                <div className="grid gap-3">
                  {[
                    [
                      "Signal found",
                      "Activity, narrative, or market structure worth investigating.",
                      "var(--pt-mood-joyful)",
                    ],
                    [
                      "Position revealed",
                      "A trader puts capital behind the idea before it reaches you.",
                      "var(--pt-mood-calm)",
                    ],
                    [
                      "Conviction published",
                      "Their why now, falsifier, risks, and onchain checks become readable.",
                      "var(--pt-mood-sad)",
                    ],
                  ].map(([title, body, tint], index) => (
                    <div
                      key={title}
                      className="flex gap-4 rounded-[20px] border border-line bg-surface/90 p-4 shadow-sm"
                    >
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl font-mono text-[10px] font-extrabold text-ink"
                        style={{ background: tint }}
                      >
                        0{index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-extrabold text-ink">{title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-3">
                          {body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex items-center gap-3 rounded-[20px] bg-brand px-5 py-4 text-brand-on shadow-md">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/12 text-sm">
                    ✦
                  </span>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/55">
                      Your Discover section
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-white">
                      Curated tokens and the people who believe in them.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="why-conviction"
          className="mx-auto w-full max-w-[1280px] px-6 pb-32 sm:px-10 sm:pb-40 lg:px-14"
        >
          <div className="grid items-end gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className={`${styles.reveal} max-w-[500px]`}>
              <span className="pt-eyebrow">A different kind of trading card</span>
              <h2 className="mt-5 font-display text-[clamp(3rem,6vw,5.5rem)] font-medium leading-[0.96] tracking-[-0.045em] text-ink">
                A position should{" "}
                <span className="italic text-brand">explain itself.</span>
              </h2>
            </div>
            <p
              className={`${styles.reveal} ${styles.revealFromRight} max-w-[610px] text-lg leading-[1.75] text-ink-2 lg:justify-self-end`}
              style={{ transitionDelay: "100ms" }}
            >
              Most trading products show you movement and ask you to chase it.
              Conviction shows you the decision: the position, the timing, the
              risk, and the facts behind it. You can agree, disagree, or keep
              watching.
            </p>
          </div>

          <div className="mt-20 grid gap-px overflow-hidden rounded-[32px] border border-line bg-line shadow-sm sm:grid-cols-2 lg:mt-24 lg:grid-cols-4">
            {CARD_ANATOMY.map((item, index) => (
              <article
                key={item.label}
                className={`${styles.reveal} ${styles.revealScale} group min-h-[290px] bg-surface p-7 transition-colors hover:bg-surface-2 sm:p-8`}
                style={{ transitionDelay: `${index * 85}ms` }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-full font-mono text-xs font-bold text-ink"
                    style={{ background: item.tint }}
                  >
                    0{index + 1}
                  </span>
                  <span className="text-xl text-ink-4 transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </div>
                <p className="mt-12 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-4">
                  {item.label}
                </p>
                <h3 className="mt-3 font-display text-[28px] font-semibold leading-tight text-ink">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-[1.7] text-ink-3">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-4 sm:px-8">
          <div className="relative mx-auto max-w-[1240px] overflow-hidden rounded-[38px] bg-brand px-6 py-20 text-brand-on shadow-lg sm:px-12 sm:py-24 lg:px-20 lg:py-28">
            <div className={styles.darkPanelGlow} aria-hidden />
            <div className="relative grid items-center gap-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
              <div className={`${styles.reveal} max-w-[540px]`}>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-white/55">
                  The invisible advantage
                </span>
                <h2 className="mt-5 font-display text-[clamp(3rem,6vw,5.5rem)] font-medium leading-[0.95] tracking-[-0.045em] text-white">
                  One balance.
                  <br />
                  One swipe.
                  <br />
                  <span className="italic text-[#f3c98b]">No bridge ritual.</span>
                </h2>
                <p className="mt-7 max-w-[500px] text-base leading-[1.8] text-white/68 sm:text-lg">
                  Your money can live in different places. Conviction makes it
                  feel like one balance, so backing a thesis never starts with
                  network menus, gas tokens, or moving money by hand.
                </p>
              </div>

              <div
                className={`${styles.reveal} ${styles.revealScale} ${styles.balanceVisual}`}
                style={{ transitionDelay: "140ms" }}
              >
                <div className={styles.balanceSourceOne}>
                  <span>ETH</span>
                  <strong>$428</strong>
                </div>
                <div className={styles.balanceSourceTwo}>
                  <span>USDC</span>
                  <strong>$560</strong>
                </div>
                <div className={styles.balanceSourceThree}>
                  <span>Cash</span>
                  <strong>$260</strong>
                </div>

                <div className={styles.balanceCore}>
                  <p>Unified balance</p>
                  <strong>$1,248.00</strong>
                  <span>Ready to back from anywhere</span>
                </div>

                <div className={styles.balanceAction}>
                  <span>Back 10%</span>
                  <strong>$124.80</strong>
                  <span aria-hidden>→</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="ai-agent"
          className="mx-auto w-full max-w-[1280px] px-6 py-32 sm:px-10 sm:py-40 lg:px-14"
        >
          <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,0.84fr)_minmax(500px,1.16fr)]">
            <div className={`${styles.reveal} max-w-[560px]`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="pt-eyebrow">A universal trading interface</span>
                <span className={styles.availableBadge}>
                  <span aria-hidden />
                  MCP ready
                </span>
              </div>
              <h2 className="mt-6 font-display text-[clamp(3rem,6vw,5.5rem)] font-medium leading-[0.95] tracking-[-0.045em] text-ink">
                Give your agent
                <br />
                <span className="italic text-brand">the whole market.</span>
              </h2>
              <p className="mt-7 max-w-[530px] text-base leading-[1.8] text-ink-2 sm:text-lg">
                Conviction MCP gives an AI agent one safe interface to read
                balances, find routes, and trade across supported chains. You
                express the goal; the agent and your EIP-7702 Universal Account
                handle the crypto complexity underneath.
              </p>

              <div
                className={styles.upgradePath}
                aria-label="EIP-7702 account upgrade"
              >
                <span>
                  <small>Before</small>
                  Your wallet
                </span>
                <span className={styles.upgradeArrow} aria-hidden>
                  →
                </span>
                <span>
                  <small>EIP-7702</small>
                  Same address
                </span>
                <span className={styles.upgradeArrow} aria-hidden>
                  →
                </span>
                <span>
                  <small>After</small>
                  Agent-ready
                </span>
              </div>

              <div className="mt-9 grid gap-4 sm:grid-cols-2">
                <div className={styles.agentBenefit}>
                  <span className={styles.agentBenefitIcon} aria-hidden>
                    ✦
                  </span>
                  <div>
                    <strong>Intent becomes execution</strong>
                    <p>
                      Ask in plain English. Review the result. Confirm the move.
                    </p>
                  </div>
                </div>
                <div className={styles.agentBenefit}>
                  <span className={styles.agentBenefitIcon} aria-hidden>
                    ↗
                  </span>
                  <div>
                    <strong>One MCP across crypto</strong>
                    <p>
                      Connect once instead of building a separate integration
                      for every chain.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`${styles.reveal} ${styles.revealScale} ${styles.agentVisual}`}
              style={{ transitionDelay: "130ms" }}
            >
              <div className={styles.agentWindow}>
                <div className={styles.agentWindowHeader}>
                  <div className="flex items-center gap-3">
                    <span className={styles.agentSpark} aria-hidden>
                      ✦
                    </span>
                    <div>
                      <strong>Conviction agent</strong>
                      <small>Connected to your EIP-7702 Universal Account</small>
                    </div>
                  </div>
                  <span className={styles.agentStatus}>Ready</span>
                </div>

                <div className={styles.agentConversation}>
                  <div className={styles.userPrompt}>
                    Move $125 of my portfolio to cash.
                  </div>
                  <div className={styles.agentReply}>
                    <span className={styles.replySpark} aria-hidden>
                      ✦
                    </span>
                    <div>
                      <p>
                        I found the best route across your balance. You’ll end
                        up with approximately $124.72 in cash.
                      </p>
                      <div className={styles.agentQuote}>
                        <span>
                          <small>You’re moving</small>
                          <strong>$125.00</strong>
                        </span>
                        <span aria-hidden>→</span>
                        <span>
                          <small>You’ll receive</small>
                          <strong>≈ $124.72</strong>
                        </span>
                      </div>
                      <button type="button" onClick={login}>
                        Review and confirm
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.networkCloud} aria-label="Supported networks">
                <div className={styles.networkCloudHeader}>
                  <span>Agent trading access across</span>
                  <strong>10 networks</strong>
                </div>
                <div className={styles.networkGrid}>
                  {SUPPORTED_NETWORKS.map((network, index) => (
                    <div
                      key={network.name}
                      className={styles.networkChip}
                      style={{ animationDelay: `${300 + index * 55}ms` }}
                    >
                      <span
                        className={styles.networkIcon}
                        style={{
                          background: network.color,
                          color:
                            network.name === "Solana" ||
                            network.name === "BNB Chain"
                              ? "#17101a"
                              : "#ffffff",
                        }}
                        aria-hidden
                      >
                        {network.short}
                      </span>
                      {network.name}
                    </div>
                  ))}
                </div>
                <div className={styles.poweredBy}>
                  <span aria-hidden>✦</span>
                  Powered by Particle Network Universal Accounts
                </div>
              </div>

              <div className={styles.mcpCard}>
                <span className={styles.mcpIcon} aria-hidden>
                  M
                </span>
                <span>
                  <strong>Conviction MCP</strong>
                  <small>One interface · 10 networks · Ready</small>
                </span>
                <span className={styles.mcpArrow} aria-hidden>
                  →
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto w-full max-w-[1180px] px-6 py-32 sm:px-10 sm:py-40"
        >
          <div className={`${styles.reveal} mx-auto max-w-[720px] text-center`}>
            <span className="pt-eyebrow">How it works</span>
            <h2 className="mt-5 font-display text-[clamp(3rem,6vw,5rem)] font-medium leading-[0.98] tracking-[-0.04em] text-ink">
              From curiosity to conviction.
            </h2>
            <p className="mx-auto mt-6 max-w-[600px] text-lg leading-[1.75] text-ink-3">
              The interface stays quiet so the decision can do the talking.
            </p>
          </div>

          <div className="mt-20 grid gap-12 lg:grid-cols-3 lg:gap-0">
            {STEPS.map((step, index) => (
              <article
                key={step.n}
                className={`${styles.reveal} relative px-2 lg:px-10 ${
                  index > 0 ? "lg:border-l lg:border-line" : ""
                }`}
                style={{ transitionDelay: `${index * 110}ms` }}
              >
                <div className="font-mono text-xs font-bold tracking-[0.16em] text-brand">
                  {step.n}
                </div>
                <h3 className="mt-7 font-display text-[32px] font-semibold leading-tight text-ink">
                  {step.title}
                </h3>
                <p className="mt-4 max-w-[320px] text-sm leading-[1.75] text-ink-3">
                  {step.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="faq"
          className="mx-auto grid w-full max-w-[1180px] gap-16 px-6 pb-32 sm:px-10 sm:pb-40 lg:grid-cols-[340px_minmax(0,1fr)]"
        >
          <div className={styles.reveal}>
            <span className="pt-eyebrow">Questions, answered plainly</span>
            <h2 className="mt-5 font-display text-5xl font-medium leading-[1.02] tracking-[-0.035em] text-ink">
              Before you
              <br />
              make the call.
            </h2>
            <p className="mt-6 max-w-[300px] text-sm leading-[1.75] text-ink-3">
              Conviction is designed to make a complex trade feel simple—not to
              hide the risk.
            </p>
          </div>

          <div
            className={`${styles.reveal} ${styles.revealFromRight} border-b border-line`}
            style={{ transitionDelay: "100ms" }}
          >
            {FAQS.map((faq, index) => {
              const open = openFaq === index;

              return (
                <div key={faq.q} className="border-t border-line">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : index)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-5 py-6 text-left sm:py-7"
                  >
                    <span className="flex-1 font-display text-xl font-semibold text-ink sm:text-2xl">
                      {faq.q}
                    </span>
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong text-lg text-ink-2 transition ${
                        open ? "rotate-45 bg-surface" : ""
                      }`}
                      aria-hidden
                    >
                      +
                    </span>
                  </button>
                  <div className={open ? styles.faqOpen : styles.faqClosed}>
                    <p className="max-w-[660px] pb-7 text-sm leading-[1.8] text-ink-3 sm:text-[15px]">
                      {faq.a}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-4 sm:px-8 sm:pb-8">
          <div
            className={`${styles.reveal} ${styles.revealScale} relative mx-auto flex max-w-[1240px] flex-col items-center overflow-hidden rounded-[38px] bg-surface px-6 py-20 text-center shadow-sm sm:py-28`}
          >
            <div className={styles.ctaGlow} aria-hidden />
            <span className="relative pt-eyebrow">Today’s deck is waiting</span>
            <h2 className="relative mt-6 max-w-[800px] font-display text-[clamp(3.25rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.05em] text-ink">
              See the position.
              <br />
              Read the <span className="italic text-brand">why.</span>
            </h2>
            <p className="relative mt-7 max-w-[510px] text-base leading-[1.75] text-ink-3">
              No anonymous signal. No blind copy. Just a disclosed position and
              the reasoning behind it.
            </p>
            <button
              type="button"
              onClick={login}
              className="relative mt-10 rounded-full bg-brand px-8 py-4 text-[15px] font-bold text-brand-on shadow-md transition hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-lg"
            >
              Open today&apos;s deck →
            </button>
          </div>
        </section>
      </main>

      <footer
        className={`${styles.reveal} relative mx-auto flex w-full max-w-[1280px] flex-col gap-10 px-6 py-12 sm:px-10 lg:px-14`}
      >
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div className="max-w-[340px]">
            <div className="flex items-center gap-3">
              <span className={styles.logoMark} aria-hidden>
                <span>C</span>
              </span>
              <span className="font-display text-[22px] font-semibold text-ink">
                Conviction
              </span>
            </div>
            <p className="mt-4 text-sm leading-[1.7] text-ink-3">
              Revealed positions, published reasoning, and one unified balance
              to act from.
            </p>
          </div>
          <nav className="flex flex-wrap items-start gap-x-7 gap-y-4 text-sm font-semibold text-ink-3">
            <a
              href="#why-conviction"
              onClick={scrollTo("why-conviction")}
              className="transition-colors hover:text-ink"
            >
              Why Conviction
            </a>
            <a
              href="#how-it-works"
              onClick={scrollTo("how-it-works")}
              className="transition-colors hover:text-ink"
            >
              How it works
            </a>
            <a
              href="#ai-agent"
              onClick={scrollTo("ai-agent")}
              className="transition-colors hover:text-ink"
            >
              AI agent
            </a>
            <a
              href="#faq"
              onClick={scrollTo("faq")}
              className="transition-colors hover:text-ink"
            >
              FAQ
            </a>
            <Link href="/docs" className="transition-colors hover:text-ink">
              Docs
            </Link>
            <Link href="/terms" className="transition-colors hover:text-ink">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-ink">
              Privacy
            </Link>
          </nav>
        </div>

        <div className="flex flex-col gap-4 border-t border-line pt-7 text-xs leading-relaxed text-ink-4 sm:flex-row sm:items-end sm:justify-between">
          <span>© 2026 Conviction</span>
          <span className="max-w-[620px] sm:text-right">
            Nothing here is financial advice. Convictions are disclosed
            positions and community views; you trade at your own risk.
          </span>
        </div>
      </footer>
    </div>
  );
}
