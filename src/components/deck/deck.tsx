"use client";

// Swipeable card stack — left skip, up save, right back (ADR 0016 / issue #24).
// Parent passes remaining (unacted) cards; exhausted = empty list.

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { DeckCard } from "@/components/deck/deck-card";
import { GHOST_LIGHT } from "@/components/button-styles";
import {
  resolveSwipeVerb,
  SWIPE_COMMIT_PX,
  SWIPE_HINT_PX,
  type SwipeVerb,
} from "@/lib/verbs/swipe-state";
import type { ConvictionEntry } from "@/lib/verbs/types";

type DeckProps = {
  cards: ConvictionEntry[];
  onSkip: () => void;
  onSave: () => void;
  onBack: (entry: ConvictionEntry) => void;
  interactive?: boolean;
};

const HINT_CLASS: Record<SwipeVerb, string> = {
  skip: "top-6 left-4 border border-zinc-300 bg-white text-zinc-500",
  save: "top-4 left-1/2 -translate-x-1/2 border border-amber-200 bg-amber-50 text-amber-800",
  back: "top-6 right-4 border border-blue-200 bg-blue-50 text-blue-700",
};

const HINT_LABEL: Record<SwipeVerb, string> = {
  skip: "Skip",
  save: "Save",
  back: "Back",
};

export function DeckExhausted() {
  return (
    <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200 bg-zinc-50 px-8 text-center">
      <p className="text-xl font-semibold text-zinc-900">Next drop tomorrow</p>
      <p className="mt-3 max-w-sm text-sm text-zinc-500">
        You&apos;ve seen today&apos;s cards. Scroll back through the drops on
        Discover — the feed is the archive.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/discover" className={`${GHOST_LIGHT} px-5 py-2 text-sm`}>
          Open Discover
        </Link>
        <Link
          href="/discover?filter=saved"
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          View Saved
        </Link>
      </div>
    </div>
  );
}

export function Deck({
  cards,
  onSkip,
  onSave,
  onBack,
  interactive = true,
}: DeckProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const activeId = useRef<number | null>(null);

  const current = cards[0];
  const next = cards[1];

  const commitVerb = useCallback(
    (verb: SwipeVerb) => {
      switch (verb) {
        case "skip":
          onSkip();
          break;
        case "save":
          onSave();
          break;
        case "back":
          if (current) onBack(current);
          break;
        default: {
          const _exhaustive: never = verb;
          return _exhaustive;
        }
      }
    },
    [current, onBack, onSave, onSkip],
  );

  const settle = useCallback(
    (dx: number, dy: number) => {
      if (!current || !interactive) {
        setOffsetX(0);
        setOffsetY(0);
        setDragging(false);
        return;
      }
      const verb = resolveSwipeVerb(dx, dy, SWIPE_COMMIT_PX);
      if (verb) commitVerb(verb);
      setOffsetX(0);
      setOffsetY(0);
      setDragging(false);
    },
    [commitVerb, current, interactive],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || !current) return;
    activeId.current = e.pointerId;
    startX.current = e.clientX;
    startY.current = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || activeId.current !== e.pointerId) return;
    setOffsetX(e.clientX - startX.current);
    setOffsetY(e.clientY - startY.current);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    settle(e.clientX - startX.current, e.clientY - startY.current);
  };

  if (!current) {
    return <DeckExhausted />;
  }

  const hint = resolveSwipeVerb(offsetX, offsetY, SWIPE_HINT_PX);
  const rotation = offsetX / 28;

  return (
    <div className="relative mx-auto h-[32rem] w-full max-w-md touch-none select-none">
      {next && (
        <div className="absolute inset-0 scale-[0.96] opacity-60">
          <DeckCard entry={next} />
        </div>
      )}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {hint && (
          <div
            className={`pointer-events-none absolute z-10 rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide uppercase ${HINT_CLASS[hint]}`}
          >
            {HINT_LABEL[hint]}
          </div>
        )}
        <DeckCard entry={current} />
      </div>

      <div className="absolute -bottom-14 left-0 right-0 flex justify-center gap-3">
        <button
          type="button"
          disabled={!interactive}
          onClick={onSkip}
          className={`${GHOST_LIGHT} px-5 py-2 text-sm`}
        >
          Skip
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={onSave}
          className="rounded-full border border-amber-200 bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={() => onBack(current)}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}
