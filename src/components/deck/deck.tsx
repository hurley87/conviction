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
  skip: "top-6 left-4 border border-line-strong bg-surface text-ink-3",
  save: "top-4 left-1/2 -translate-x-1/2 border border-warning/25 bg-[#fff6df] text-warning",
  back: "top-6 right-4 border border-brand/20 bg-brand-soft text-brand",
};

const HINT_LABEL: Record<SwipeVerb, string> = {
  skip: "Skip",
  save: "Save",
  back: "Back",
};

export function DeckExhausted() {
  return (
    <div className="flex min-h-[32rem] flex-col items-center justify-center rounded-[30px] border border-dashed border-line-strong bg-surface/65 px-8 text-center shadow-sm">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft font-display text-2xl italic text-brand">
        ✓
      </span>
      <p className="mt-5 font-display text-3xl font-semibold text-ink">That’s today’s deck.</p>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-3">
        You&apos;ve seen today&apos;s shortlist. Keep exploring curated drops
        in Discover, or return to the ideas you saved.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link href="/discover" className={`${GHOST_LIGHT} px-5 py-2 text-sm`}>
          Open Discover
        </Link>
        <Link
          href="/discover?filter=saved"
          className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-brand-on shadow-md transition hover:-translate-y-0.5 hover:bg-brand-hover"
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
    <div className="relative mx-auto h-[35rem] w-full max-w-[470px] touch-none select-none sm:h-[37rem]">
      {next && (
        <div className="absolute inset-0 translate-y-3 scale-[0.965] rotate-[2deg] opacity-55">
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
            className={`pointer-events-none absolute z-10 rounded-full px-4 py-2 text-xs font-extrabold tracking-[0.12em] uppercase shadow-md backdrop-blur ${HINT_CLASS[hint]}`}
          >
            {HINT_LABEL[hint]}
          </div>
        )}
        <DeckCard entry={current} />
      </div>

      <div className="absolute -bottom-[76px] left-0 right-0 flex justify-center gap-3">
        <button
          type="button"
          disabled={!interactive}
          onClick={onSkip}
          className="group flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface/80 px-4 text-sm font-bold text-ink-3 shadow-sm transition hover:-translate-y-0.5 hover:bg-surface hover:text-ink hover:shadow-md disabled:opacity-50"
        >
          <span className="text-lg transition-transform group-hover:-translate-x-0.5">←</span>
          Skip
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={onSave}
          className="group flex h-12 items-center gap-2 rounded-full border border-warning/25 bg-[#fff6df] px-4 text-sm font-bold text-warning shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
        >
          <span className="text-lg transition-transform group-hover:-translate-y-0.5">↑</span>
          Save
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={() => onBack(current)}
          className="group flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-brand-on shadow-md transition hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-lg disabled:opacity-50"
        >
          Back
          <span className="text-lg transition-transform group-hover:translate-x-0.5">→</span>
        </button>
      </div>
    </div>
  );
}
