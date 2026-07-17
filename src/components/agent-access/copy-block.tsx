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
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-[14px] bg-ink px-4 py-3 font-mono text-xs leading-5 text-white">
          {value}
        </pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
          className="rounded-[14px] bg-brand px-5 py-3 text-sm font-extrabold text-brand-on transition hover:bg-brand-hover"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
