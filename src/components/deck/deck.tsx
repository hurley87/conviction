"use client";

// Swipeable card stack — left skip, right back (ADR 0016).

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { DeckCard } from "@/components/deck/deck-card";
import { GHOST_LIGHT } from "@/components/button-styles";
import { isDeckExhausted } from "@/lib/verbs/deck";
import type { ConvictionEntry } from "@/lib/verbs/types";

const SWIPE_THRESHOLD_PX = 110;

type DeckProps = {
  cards: ConvictionEntry[];
  index: number;
  onSkip: () => void;
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
      <div className="mt-6">
        <Link href="/discover" className={`${GHOST_LIGHT} px-5 py-2 text-sm`}>
          Open Discover
        </Link>
      </div>
    </div>
  );
}

export function Deck({
  cards,
  index,
  onSkip,
  onBack,
  interactive = true,
}: DeckProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const activeId = useRef<number | null>(null);

  const exhausted = isDeckExhausted(cards, index);
  const current = !exhausted ? cards[index] : undefined;
  const next = !exhausted ? cards[index + 1] : undefined;

  const settle = useCallback(
    (dx: number) => {
      if (!current || !interactive) {
        setOffsetX(0);
        setDragging(false);
        return;
      }
      if (dx <= -SWIPE_THRESHOLD_PX) {
        onSkip();
      } else if (dx >= SWIPE_THRESHOLD_PX) {
        onBack(current);
      }
      setOffsetX(0);
      setDragging(false);
    },
    [current, interactive, onBack, onSkip],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || !current) return;
    activeId.current = e.pointerId;
    startX.current = e.clientX;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || activeId.current !== e.pointerId) return;
    setOffsetX(e.clientX - startX.current);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    settle(e.clientX - startX.current);
  };

  if (exhausted) {
    return <DeckExhausted />;
  }

  const rotation = offsetX / 28;
  const skipHint = offsetX < -40;
  const backHint = offsetX > 40;

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
            transform: `translateX(${offsetX}px) rotate(${rotation}deg)`,
            transition: dragging ? "none" : "transform 180ms ease-out",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {(skipHint || backHint) && (
            <div
              className={`pointer-events-none absolute top-6 z-10 rounded-full px-4 py-1.5 text-xs font-semibold tracking-wide uppercase ${
                skipHint
                  ? "left-4 border border-zinc-300 bg-white text-zinc-500"
                  : "right-4 border border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {skipHint ? "Skip" : "Back"}
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
          onClick={() => current && onBack(current)}
          className="rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}
