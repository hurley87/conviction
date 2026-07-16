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
      className={`rounded-full px-4 py-2 text-sm font-bold transition ${
        active
          ? "bg-brand text-brand-on shadow-md"
          : "border border-line-strong bg-surface/70 text-ink-3 shadow-sm hover:-translate-y-0.5 hover:bg-surface hover:text-ink"
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
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 rounded-full">
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
        <div className="app-card flex flex-col items-center px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-xl text-brand">
            {filter === "saved" ? "↑" : "✦"}
          </span>
          <p className="mt-4 font-display text-2xl font-semibold text-ink">
            {filter === "saved" ? "Nothing saved yet." : "The archive is quiet."}
          </p>
          <p className="mt-2 max-w-md text-sm text-ink-3">
          {filter === "saved"
            ? "No saved cards yet — swipe up on the deck to save one."
            : "No convictions yet — make a trade and post your thesis."}
          </p>
        </div>
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
