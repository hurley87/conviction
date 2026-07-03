"use client";

// Post-trade conviction publish surface (issue #4). Dollars-only — no token
// names or charts here; those live in the feed only.

import { useState } from "react";
import { PRIMARY_LIGHT, GHOST_LIGHT } from "@/components/button-styles";

type PostConvictionProps = {
  onPost: (thesis: string) => Promise<void>;
  onSkip: () => void;
  posting: boolean;
  posted: boolean;
};

export function PostConviction({
  onPost,
  onSkip,
  posting,
  posted,
}: PostConvictionProps) {
  const [thesis, setThesis] = useState("");

  if (posted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left">
        <p className="text-sm font-medium text-emerald-700">
          Conviction posted to the feed.
        </p>
        <a
          href="/discover"
          className="mt-2 inline-block text-xs text-blue-600 hover:underline"
        >
          View the feed →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Share your conviction
      </p>
      <p className="mt-2 text-sm text-zinc-600">
        Why did you make this trade? Post it to the public feed.
      </p>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="Your thesis in a sentence or two…"
        rows={3}
        disabled={posting}
        className="mt-3 w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400 focus:outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void onPost(thesis)}
          disabled={posting || !thesis.trim()}
          className={`${PRIMARY_LIGHT} flex-1 py-2 text-sm`}
        >
          {posting ? "Posting…" : "Post conviction"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={posting}
          className={`${GHOST_LIGHT} px-4 py-2 text-sm`}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
