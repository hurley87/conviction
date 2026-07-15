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
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold text-zinc-900">Discover</h1>
      <p className="mt-2 text-sm text-zinc-500">
        The archive of drops — newest first. Saved cards live behind the chip.
      </p>
      <div className="mt-8">
        <FeedBoard convictions={convictions} filter={filter} />
      </div>
    </div>
  );
}
