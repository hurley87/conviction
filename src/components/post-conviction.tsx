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
      <div className="rounded-[22px] border border-success/20 bg-[#edf6e9] p-4 text-left">
        <p className="text-sm font-bold text-success">
          Conviction posted to the feed.
        </p>
        <a
          href="/discover"
          className="mt-2 inline-block text-xs font-bold text-brand hover:underline"
        >
          View the feed →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-line bg-surface p-4 text-left shadow-sm">
      <p className="pt-eyebrow">Share your conviction</p>
      <p className="mt-2 text-sm text-ink-2">
        Why did you make this trade? Post it to the public feed.
      </p>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="Your thesis in a sentence or two…"
        rows={3}
        disabled={posting}
        className="app-input mt-3 w-full resize-none rounded-[16px] px-4 py-3 text-sm"
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
