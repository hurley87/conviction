import { FeedBoard } from "@/components/feed-board";
import { listConvictions } from "@/lib/convictions";
import type { FeedFilter } from "@/components/feed";

export const dynamic = "force-dynamic";

type DiscoverPageProps = {
  searchParams: Promise<{ filter?: string }>;
};

function parseFilter(raw: string | undefined): FeedFilter {
  return raw === "saved" ? "saved" : "all";
}

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const params = await searchParams;
  const filter = parseFilter(params.filter);
  const convictions = await listConvictions();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_0_5px_rgba(79,138,90,0.1)]" />
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-ink-3">
            Curated across crypto
          </p>
        </div>
        <h1 className="mt-5 font-display text-[clamp(3.25rem,7vw,5.75rem)] font-medium leading-[0.9] tracking-[-0.05em] text-ink">
          Find what deserves
          <br />
          <span className="italic text-brand">a closer look.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-3">
          No one can research every token across every chain. Discover brings
          you a curated set through other people&apos;s revealed positions, so
          you can read what they believe, why they backed it, and the risks
          before deciding what to save, skip, or back.
        </p>
      </div>
      <div className="mt-10">
        <FeedBoard convictions={convictions} filter={filter} />
      </div>
    </div>
  );
}
