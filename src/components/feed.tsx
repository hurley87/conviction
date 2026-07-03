// Conviction feed list (issue #4 / #5).

import { ConvictionCard } from "@/components/conviction-card";
import type { BackerApi } from "@/hooks/use-backer";
import type { ConvictionEntry } from "@/lib/verbs/types";

type FeedProps = {
  convictions: ConvictionEntry[];
  backer: BackerApi;
};

export function Feed({ convictions, backer }: FeedProps) {
  if (convictions.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        No convictions yet — make a trade and post your thesis.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {convictions.map((entry) => (
        <ConvictionCard key={entry.entryId} entry={entry} backer={backer} />
      ))}
    </div>
  );
}
