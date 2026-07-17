"use client";

import { useRef } from "react";
import type { DeckGesture } from "@/lib/onboarding-machine";

export function PracticeCard({
  onGesture,
}: {
  onGesture: (gesture: DeckGesture) => void;
}) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const finishPointer = (x: number, y: number) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      onGesture(dx < 0 ? "skip" : "back");
    } else if (dy < -55) {
      onGesture("save");
    }
  };

  return (
    <div>
      <article
        className="touch-none select-none rounded-[28px] border border-line bg-surface p-6 shadow-lg sm:p-8"
        onPointerDown={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => finishPointer(event.clientX, event.clientY)}
        aria-label="Practice conviction card. Swipe left to skip, up to save, or right to back."
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold text-ink">@practice_desk</p>
            <p className="mt-1 text-[11px] text-ink-4">Synthetic lesson card</p>
          </div>
          <span className="rounded-full bg-[var(--pt-mood-calm)] px-3 py-1.5 text-xs font-bold">
            Long ETH
          </span>
        </div>
        <p className="mt-6 pt-eyebrow">Practice thesis</p>
        <p className="mt-2 font-display text-2xl italic leading-snug">
          “Activity is recovering, but this only deserves a small, risk-defined
          position.”
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
            <strong className="block text-ink">Why now</strong>
            Usage and liquidity are improving together.
          </div>
          <div className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
            <strong className="block text-ink">What breaks it</strong>
            Activity falls below the prior monthly low.
          </div>
        </div>
      </article>
      <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Practice card actions">
        {(
          [
            ["skip", "←", "Skip"],
            ["save", "↑", "Save"],
            ["back", "→", "Back"],
          ] as const
        ).map(([gesture, arrow, label]) => (
          <button
            key={gesture}
            type="button"
            onClick={() => onGesture(gesture)}
            className="rounded-2xl border border-line-strong bg-surface px-3 py-3 text-sm font-bold transition hover:border-brand"
          >
            <span aria-hidden>{arrow}</span> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
