"use client";

// Swipeable card stack — left skip, up save, right back (ADR 0016 / issue #24).

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { DeckCard } from "@/components/deck/deck-card";
import { GHOST_LIGHT } from "@/components/button-styles";
import { isDeckExhausted } from "@/lib/verbs/deck";
import type { ConvictionEntry } from "@/lib/verbs/types";

const SWIPE_THRESHOLD_PX = 110;

type DeckProps = {
  cards: ConvictionEntry[];
  /** Index into remaining cards — usually 0 when the parent filters acted-on. */
  index?: number;
  onSkip: () => void;
  onSave: () => void;
  onBack: (entry: ConvictionEntry) => void;
  interactive?: boolean;
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

type SwipeHint = "skip" | "save" | "back" | null;

export function Deck({
  cards,
  index = 0,
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

  const exhausted = isDeckExhausted(cards, index);
  const current = !exhausted ? cards[index] : undefined;
  const next = !exhausted ? cards[index + 1] : undefined;

  const settle = useCallback(
    (dx: number, dy: number) => {
      if (!current || !interactive) {
        setOffsetX(0);
        setOffsetY(0);
        setDragging(false);
        return;
      }
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      // Up-swipe save wins when vertical dominates; otherwise horizontal.
      if (dy <= -SWIPE_THRESHOLD_PX && absY >= absX) {
        onSave();
      } else if (dx <= -SWIPE_THRESHOLD_PX && absX > absY) {
        onSkip();
      } else if (dx >= SWIPE_THRESHOLD_PX && absX > absY) {
        onBack(current);
      }
      setOffsetX(0);
      setOffsetY(0);
      setDragging(false);
    },
    [current, interactive, onBack, onSave, onSkip],
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

  if (exhausted) {
    return <DeckExhausted />;
  }

  const absX = Math.abs(offsetX);
  const absY = Math.abs(offsetY);
  let hint: SwipeHint = null;
  if (offsetY < -40 && absY >= absX) hint = "save";
  else if (offsetX < -40 && absX > absY) hint = "skip";
  else if (offsetX > 40 && absX > absY) hint = "back";

  const rotation = offsetX / 28;

  return (
    <div className="relative mx-auto h-[32rem] w-full max-w-md touch-none select-none">
      {next && (
        <div className="absolute inset-0 scale-[0.96] opacity-60">
          <DeckCard entry={next} />
        </div>
      )}
      {current && (
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
              className={`pointer-events-none absolute z-10 rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide uppercase ${
                hint === "skip"
                  ? "top-6 left-4 border border-zinc-300 bg-white text-zinc-500"
                  : hint === "save"
                    ? "top-4 left-1/2 -translate-x-1/2 border border-amber-200 bg-amber-50 text-amber-800"
                    : "top-6 right-4 border border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {hint === "skip" ? "Skip" : hint === "save" ? "Save" : "Back"}
            </div>
          )}
          <DeckCard entry={current} />
        </div>
      )}

      <div className="absolute -bottom-14 left-0 right-0 flex justify-center gap-3">
        <button
          type="button"
          disabled={!interactive}
          onClick={() => current && onSkip()}
          className={`${GHOST_LIGHT} px-5 py-2 text-sm`}
        >
          Skip
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={() => current && onSave()}
          className="rounded-full border border-amber-200 bg-amber-50 px-5 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          disabled={!interactive}
          onClick={() => current && onBack(current)}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}
