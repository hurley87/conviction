"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account/account-context";
import { formatUsd, formatTimestamp } from "@/lib/format";
import { PRIMARY_LIGHT } from "@/components/button-styles";
import { IS_LIVE } from "@/lib/env";
import type { ActivityEntry } from "@/lib/activity";
import type { ConvictionEntry } from "@/lib/verbs/types";

type TimelineItem =
  | { type: "activity"; entry: ActivityEntry }
  | { type: "conviction"; entry: ConvictionEntry };

function mergeTimeline(
  activity: ActivityEntry[],
  convictions: ConvictionEntry[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...activity.map((entry) => ({ type: "activity" as const, entry })),
    ...convictions.map((entry) => ({ type: "conviction" as const, entry })),
  ];
  const time = (item: TimelineItem) => new Date(item.entry.createdAt).getTime();
  return items.sort((a, b) => time(b) - time(a));
}

function ActivityTimelineItem({ item }: { item: TimelineItem }) {
  if (item.type === "activity") {
    const { entry } = item;
    return (
      <article className="app-card app-card-interactive relative p-5 pl-16 sm:p-6 sm:pl-[76px]">
        <span className="absolute left-5 top-5 grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand sm:left-6 sm:top-6">
          ↗
        </span>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-4">
              {entry.kind}
            </p>
            <p className="mt-1 text-sm font-bold text-ink">
              {entry.summary}
            </p>
            {entry.amountUsd != null && (
              <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
                {formatUsd(entry.amountUsd)}
              </p>
            )}
          </div>
          <time className="shrink-0 text-xs text-ink-4">
            {formatTimestamp(entry.createdAt)}
          </time>
        </div>
        {entry.receiptSlug && (
          <Link
            href={`/r/${entry.receiptSlug}`}
            className="mt-3 inline-block text-xs font-bold text-brand underline-offset-4 hover:underline"
          >
            View receipt
          </Link>
        )}
      </article>
    );
  }

  const { entry } = item;
  return (
    <article className="app-card app-card-interactive relative p-5 pl-16 sm:p-6 sm:pl-[76px]">
      <span className="absolute left-5 top-5 grid h-9 w-9 place-items-center rounded-xl bg-[#fff1c9] text-warning sm:left-6 sm:top-6">
        ✦
      </span>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-brand">
            Conviction posted
          </p>
          <p className="mt-2 font-display text-xl font-medium leading-relaxed text-ink">
            {entry.thesis}
          </p>
          <p className="mt-3 text-xs font-bold tabular-nums text-ink-4">
            {formatUsd(entry.trade.sizeUsd)} · {entry.trade.toAsset.toUpperCase()}
          </p>
        </div>
        <time className="shrink-0 text-xs text-ink-4">
          {formatTimestamp(entry.createdAt)}
        </time>
      </div>
      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="mt-3 inline-block text-xs font-bold text-brand underline-offset-4 hover:underline"
        >
          View receipt
        </Link>
      )}
    </article>
  );
}

export function ActivityView() {
  const account = useAccount();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "done">(
    "idle",
  );

  useEffect(() => {
    if (!account.handle) return;

    let cancelled = false;
    const load = async () => {
      setFetchState("loading");
      try {
        const [activityRes, convictionsRes] = await Promise.all([
          fetch(`/api/activity?handle=${encodeURIComponent(account.handle!)}`),
          fetch(
            `/api/convictions?handle=${encodeURIComponent(account.handle!)}`,
          ),
        ]);

        const [activityData, convictionsData] = (await Promise.all([
          activityRes.json(),
          convictionsRes.json(),
        ])) as [
          { entries?: ActivityEntry[] },
          { entries?: ConvictionEntry[] },
        ];

        if (!cancelled) {
          setItems(
            mergeTimeline(
              activityData.entries ?? [],
              convictionsData.entries ?? [],
            ),
          );
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setFetchState("done");
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [account.handle]);

  const loading = Boolean(account.handle) && fetchState === "loading";

  if (!account.ready) {
    return <div className="h-40 animate-pulse rounded-[28px] bg-surface-3" />;
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="py-16 text-center">
        <p className="text-ink-3">Sign in to view your activity.</p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} mt-6 px-8 py-3`}
        >
          Sign in with email or X
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="pt-eyebrow">Receipts, moves, and ideas</p>
          <h1 className="mt-2 font-display text-[clamp(3.2rem,7vw,5.8rem)] font-medium leading-[0.9] tracking-[-0.05em] text-ink">
            Your <span className="italic text-brand">trail.</span>
          </h1>
        </div>
        <p className="max-w-xs text-sm leading-relaxed text-ink-3 sm:pb-2">
          A human-readable history of what you moved, backed, and published.
        </p>
      </div>

      {loading ? (
        <div className="mt-9 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-[22px] bg-surface-3" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="app-card mt-9 flex flex-col items-center px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-xl text-brand">
            ↗
          </span>
          <p className="mt-4 font-display text-2xl font-semibold text-ink">
            Your trail starts with one move.
          </p>
          <p className="mt-2 text-sm text-ink-3">
            Make a trade or post a conviction and it will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-9 flex flex-col gap-4">
          {items.map((item) => (
            <ActivityTimelineItem
              key={
                item.type === "activity"
                  ? item.entry.id
                  : item.entry.entryId
              }
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}
