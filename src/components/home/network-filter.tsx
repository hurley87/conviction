"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { formatUsd } from "@/lib/format";
import { networkColor } from "@/lib/networks";

type NetworkFilterProps = {
  networks: string[];
  networkTotals: Record<string, number>;
  value: string;
  onChange: (network: string) => void;
};

const NETWORK_MARKS: Record<string, string> = {
  arbitrum: "A",
  base: "B",
  ethereum: "Ξ",
  hyperliquid: "H",
  optimism: "OP",
  polygon: "P",
  solana: "S",
};

function networkMark(network: string): string {
  return (
    NETWORK_MARKS[network.toLowerCase()] ??
    network.replace(/\s+/g, "").slice(0, 2).toUpperCase()
  );
}

function NetworkBadge({
  network,
  size = "md",
}: {
  network: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[9px] font-extrabold text-white shadow-sm ring-1 ring-white/70 ${
        size === "sm" ? "h-6 w-6 text-[8px]" : "h-9 w-9 text-[10px]"
      }`}
      style={{ background: networkColor(network) }}
      aria-hidden
    >
      {networkMark(network)}
    </span>
  );
}

function NetworkStack({ networks }: { networks: string[] }) {
  return (
    <span className="flex items-center" aria-hidden>
      {networks.slice(0, 3).map((network, index) => (
        <span
          key={network}
          className="rounded-[9px] ring-2 ring-surface"
          style={{ marginLeft: index === 0 ? 0 : -8 }}
        >
          <NetworkBadge network={network} size="sm" />
        </span>
      ))}
      {networks.length > 3 && (
        <span className="-ml-2 grid h-6 min-w-6 place-items-center rounded-[9px] bg-surface-3 px-1 text-[9px] font-extrabold text-ink-2 ring-2 ring-surface">
          +{networks.length - 3}
        </span>
      )}
    </span>
  );
}

export function NetworkFilter({
  networks,
  networkTotals,
  value,
  onChange,
}: NetworkFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useClickOutside(rootRef, close, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  const selectNetwork = (network: string) => {
    onChange(network);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const label = value === "all" ? "All networks" : value;

  return (
    <div ref={rootRef} className="relative ml-auto hidden shrink-0 pb-2.5 sm:block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="holdings-network-menu"
        aria-haspopup="listbox"
        className={`flex items-center gap-2.5 rounded-full border px-3 py-2 text-[13px] font-bold transition ${
          open
            ? "border-line-strong bg-surface text-ink shadow-md"
            : "border-transparent text-ink-2 hover:border-line hover:bg-surface/70 hover:text-ink hover:shadow-sm"
        }`}
      >
        {value === "all" ? (
          <NetworkStack networks={networks} />
        ) : (
          <NetworkBadge network={value} size="sm" />
        )}
        <span>{label}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id="holdings-network-menu"
          role="listbox"
          aria-label="Filter holdings by network"
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-[24px] border border-line bg-surface/95 p-2 shadow-lg backdrop-blur-xl"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="pt-eyebrow">Network view</p>
            <p className="mt-1 text-xs text-ink-3">
              Inspect where each balance lives.
            </p>
          </div>

          <button
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => selectNetwork("all")}
            className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition ${
              value === "all"
                ? "bg-brand-soft text-ink"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--pt-grad-dawn)] text-xs font-extrabold text-ink shadow-sm ring-1 ring-white/70">
              {networks.length}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">All networks</span>
              <span className="block text-[11px] text-ink-3">
                Combined portfolio
              </span>
            </span>
            {value === "all" && <Checkmark />}
          </button>

          <div className="my-1 border-t border-line" />

          {networks.map((network) => {
            const selected = value === network;
            return (
              <button
                key={network}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectNetwork(network)}
                className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition ${
                  selected
                    ? "bg-brand-soft text-ink"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <NetworkBadge network={network} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {network}
                  </span>
                  <span className="block text-[11px] tabular-nums text-ink-3">
                    {formatUsd(networkTotals[network] ?? 0)}
                  </span>
                </span>
                {selected && <Checkmark />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Checkmark() {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-brand-on">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m5 12 4 4L19 6" />
      </svg>
    </span>
  );
}
