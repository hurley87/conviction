"use client";

// Copyable deposit address. In 7702 mode the embedded EOA address IS the EVM
// Universal Account address, so funding it on any supported EVM chain lands in
// the unified balance. (Full EVM + Solana deposit UX is issue #3.)

import { useState } from "react";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function DepositAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        title={address}
        onClick={async () => {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 font-mono text-sm text-[#aeb4d6] transition hover:bg-white/5"
      >
        {truncate(address)}
        <span className="text-xs text-[#6b7099]">{copied ? "Copied" : "Copy"}</span>
      </button>
      <p className="text-xs text-[#4a4f74]">
        Add money: send USDC on Base or Arbitrum here
      </p>
    </div>
  );
}
