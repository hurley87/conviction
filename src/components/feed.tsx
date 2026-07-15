"use client";

// Conviction feed archive — newest drop first, with Saved filter chip (issue #24).

import Link from "next/link";
import { ConvictionCard } from "@/components/conviction-card";
import type { BackerApi } from "@/hooks/use-backer";
import type { ConvictionEntry } from "@/lib/verbs/types";
import type { SwipeState } from "@/lib/verbs/swipe-state";
import {
  filterSavedConvictions,
  isSaved,
} from "@/lib/verbs/swipe-state";

export type FeedFilter = "all" | "saved";

type FeedProps = {
  convictions: ConvictionEntry[];
  backer: BackerApi;
  swipeState: SwipeState;
  filter: FeedFilter;
};

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-900 text-white"
          : "border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
      }`}
      scroll={false}
    >
      {children}
    </Link>
  );
}

export function Feed({ convictions, backer, swipeState, filter }: FeedProps) {
  const visible =
    filter === "saved"
      ? filterSavedConvictions(convictions, swipeState)
      : convictions;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip href="/discover" active={filter === "all"}>
          All
        </FilterChip>
        <FilterChip
          href="/discover?filter=saved"
          active={filter === "saved"}
        >
          Saved
        </FilterChip>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-400">
          {filter === "saved"
            ? "No saved cards yet — swipe up on the deck to save one."
            : "No convictions yet — make a trade and post your thesis."}
        </p>
      ) : (
        visible.map((entry) => (
          <ConvictionCard
            key={entry.entryId}
            entry={entry}
            backer={backer}
            saved={isSaved(swipeState, entry.entryId)}
          />
        ))
      )}
    </div>
  );
}
