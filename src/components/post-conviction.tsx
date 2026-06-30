"use client";

// Post-trade conviction publish surface (issue #4). Dollars-only — no token
// names or charts here; those live in the feed only.

import { useState } from "react";
import { PRIMARY, GHOST } from "@/components/button-styles";

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
      <div className="rounded-2xl border border-[#37E0C8]/30 bg-[#37E0C8]/5 p-4 text-left">
        <p className="text-sm font-medium text-[#37E0C8]">
          Conviction posted to the feed.
        </p>
        <a
          href="/feed"
          className="mt-2 inline-block text-xs text-[#6C7BFF] hover:underline"
        >
          View the feed →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-left backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.25em] text-[#6b7099]">
        Share your conviction
      </p>
      <p className="mt-2 text-sm text-[#aeb4d6]">
        Why did you make this trade? Post it to the public feed.
      </p>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="Your thesis in a sentence or two…"
        rows={3}
        disabled={posting}
        className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-[#4a4f74] focus:border-[#6C7BFF]/50 focus:outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void onPost(thesis)}
          disabled={posting || !thesis.trim()}
          className={`${PRIMARY} flex-1 py-2 text-sm`}
        >
          {posting ? "Posting…" : "Post conviction"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={posting}
          className={`${GHOST} px-4 py-2 text-sm`}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
