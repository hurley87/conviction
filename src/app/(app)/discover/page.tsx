import { FeedBoard } from "@/components/feed-board";
import { listConvictions } from "@/lib/convictions";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const convictions = await listConvictions();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold text-zinc-900">Discover</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Real trades with a thesis — posted by handle.
      </p>
      <div className="mt-8">
        <FeedBoard convictions={convictions} />
      </div>
    </div>
  );
}
