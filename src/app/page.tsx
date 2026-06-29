import { AccountPanel } from "@/components/account-panel";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[#06060d] px-6 text-center text-white">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#3a3f8f] opacity-40 blur-[120px]"
      />

      <div className="relative z-10 flex flex-col items-center">
        {/* mark: three chains converging into one balance */}
        <svg
          width="120"
          height="84"
          viewBox="0 0 120 84"
          fill="none"
          className="mb-8"
          aria-hidden
        >
          <defs>
            <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#6C7BFF" />
              <stop offset="100%" stopColor="#37E0C8" />
            </linearGradient>
          </defs>
          <g
            stroke="url(#accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          >
            <line x1="18" y1="20" x2="60" y2="58" />
            <line x1="60" y1="14" x2="60" y2="58" />
            <line x1="102" y1="20" x2="60" y2="58" />
          </g>
          <g fill="#06060d" stroke="url(#accent)" strokeWidth="3.5">
            <circle cx="18" cy="20" r="8" />
            <circle cx="60" cy="14" r="8" />
            <circle cx="102" cy="20" r="8" />
          </g>
          <circle cx="60" cy="58" r="13" fill="url(#accent)" />
        </svg>

        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          Conviction
        </h1>

        <p className="mt-6 max-w-xl text-lg text-[#aeb4d6] sm:text-xl">
          Trade your Solana, Base, and Arbitrum assets from one balance — no
          bridging. Post the trades you believe in, and let anyone back them
          from any chain.
        </p>

        <div className="mt-10">
          <AccountPanel />
        </div>

        <p className="mt-12 text-xs font-medium uppercase tracking-[0.3em] text-[#6b7099]">
          One balance · Any chain · One feed
        </p>
      </div>

      <footer className="absolute bottom-6 z-10 text-xs text-[#4a4f74]">
        Powered by Particle Network Universal Accounts · EIP-7702
      </footer>
    </main>
  );
}
