"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function ActionDialog({
  title,
  description,
  dismissible = true,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dismissibleRef = useRef(dismissible);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    dismissibleRef.current = dismissible;
    onCloseRef.current = onClose;
  }, [dismissible, onClose]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeRef.current?.focus(),
    );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dismissibleRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.tabIndex >= 0);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => previouslyFocused?.focus());
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-5">
      <div
        aria-hidden
        onMouseDown={() => {
          if (dismissible) onClose();
        }}
        className="absolute inset-0 bg-[var(--pt-overlay)] backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="app-enter relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-line bg-surface shadow-[0_24px_80px_rgba(42,26,46,0.28)] sm:max-w-lg sm:rounded-[28px]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 pb-4 pt-[max(1.1rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-6 sm:pt-5">
          <div>
            <h2
              id={titleId}
              className="font-display text-2xl font-semibold tracking-tight text-ink"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 max-w-md text-sm leading-relaxed text-ink-3"
              >
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label={dismissible ? `Close ${title}` : "Transaction in progress"}
            title={
              dismissible
                ? `Close ${title}`
                : "Finish the transaction before closing"
            }
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2 transition hover:bg-surface-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
