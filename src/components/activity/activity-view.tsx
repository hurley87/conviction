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
      <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              {entry.kind}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900">
              {entry.summary}
            </p>
            {entry.amountUsd != null && (
              <p className="mt-1 text-sm tabular-nums text-zinc-500">
                {formatUsd(entry.amountUsd)}
              </p>
            )}
          </div>
          <time className="shrink-0 text-xs text-zinc-400">
            {formatTimestamp(entry.createdAt)}
          </time>
        </div>
        {entry.receiptSlug && (
          <Link
            href={`/r/${entry.receiptSlug}`}
            className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
          >
            View receipt
          </Link>
        )}
      </article>
    );
  }

  const { entry } = item;
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-blue-600">
            Conviction posted
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700">
            {entry.thesis}
          </p>
          <p className="mt-2 text-xs tabular-nums text-zinc-400">
            {formatUsd(entry.trade.sizeUsd)} · {entry.trade.toAsset.toUpperCase()}
          </p>
        </div>
        <time className="shrink-0 text-xs text-zinc-400">
          {formatTimestamp(entry.createdAt)}
        </time>
      </div>
      {entry.receiptSlug && (
        <Link
          href={`/r/${entry.receiptSlug}`}
          className="mt-3 inline-block text-xs font-medium text-blue-600 hover:underline"
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
    return <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />;
  }

  if (IS_LIVE && !account.authenticated) {
    return (
      <div className="py-16 text-center">
        <p className="text-zinc-500">Sign in to view your activity.</p>
        <button
          type="button"
          onClick={() => account.login()}
          className={`${PRIMARY_LIGHT} mt-6 px-8 py-3`}
        >
          Sign in with Twitter
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-zinc-900">Activity</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Your trades and posted convictions.
      </p>

      {loading ? (
        <div className="mt-8 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-12 text-center text-sm text-zinc-400">
          No activity yet — make a trade or post a conviction.
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
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
