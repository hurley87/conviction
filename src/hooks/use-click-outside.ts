"use client";

import { useEffect, type RefObject } from "react";

/**
 * Calls `onOutside` on a mousedown outside `ref`, only while `enabled`.
 * Used by dismissable overlays (user menu, concierge bubble).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [ref, onOutside, enabled]);
}
