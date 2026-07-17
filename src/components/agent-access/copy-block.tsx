"use client";

import { useState } from "react";

export function CopyBlock({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-ink-3">
        {label}
      </p>
      <div className="relative mt-2">
        <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-[14px] bg-ink px-4 py-3 pr-20 font-mono text-xs leading-5 text-white">
          {value}
        </pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
          className="absolute right-2 top-2 rounded-[10px] bg-white/12 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur-sm transition hover:bg-white/20"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
