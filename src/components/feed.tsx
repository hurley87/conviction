// Conviction feed list (issue #4).

import { ConvictionCard } from "@/components/conviction-card";
import type { ConvictionEntry } from "@/lib/verbs/types";

type FeedProps = {
  convictions: ConvictionEntry[];
};

export function Feed({ convictions }: FeedProps) {
  if (convictions.length === 0) {
    return (
      <p className="text-sm text-[#6b7099]">
        No convictions yet — make a trade and post your thesis.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      {convictions.map((entry) => (
        <ConvictionCard key={entry.entryId} entry={entry} />
      ))}
    </div>
  );
}
