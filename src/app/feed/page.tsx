import Link from "next/link";
import { Feed } from "@/components/feed";
import { listConvictions } from "@/lib/convictions";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const convictions = await listConvictions();

  return (
    <main className="relative flex flex-1 flex-col items-center overflow-hidden bg-[#06060d] px-6 py-16 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/4 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-[#3a3f8f] opacity-30 blur-[120px]"
      />

      <div className="relative z-10 flex w-full flex-col items-center">
        <Link
          href="/"
          className="mb-8 text-xs uppercase tracking-[0.25em] text-[#6b7099] hover:text-[#aeb4d6]"
        >
          ← Back
        </Link>

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Conviction feed
        </h1>
        <p className="mt-3 max-w-lg text-center text-sm text-[#aeb4d6]">
          Real trades with a thesis — posted by handle. Token names and charts
          appear here only.
        </p>

        <div className="mt-10">
          <Feed convictions={convictions} />
        </div>
      </div>
    </main>
  );
}
