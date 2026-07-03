"use client";

// Copyable deposit addresses from getSmartAccountOptions() (ADR 0002). In 7702
// mode the EVM address is the Universal Account; Solana is shown when available.

import { useState } from "react";
import { truncateAddress } from "@/lib/format";
import type { DepositAddresses } from "@/lib/verbs/types";

function CopyableAddress({
  address,
  label,
  hint,
}: {
  address: string;
  label: string;
  hint: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <button
        type="button"
        title={address}
        onClick={async () => {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2 font-mono text-sm text-zinc-700 transition hover:bg-zinc-50"
      >
        {truncateAddress(address)}
        <span className="text-xs text-zinc-400">
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <p className="text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

export function DepositAddress({ deposits }: { deposits: DepositAddresses }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <CopyableAddress
        address={deposits.evm}
        label="EVM"
        hint="Send USDC on Base or Arbitrum here"
      />
      {deposits.solana && (
        <CopyableAddress
          address={deposits.solana}
          label="Solana"
          hint="Send USDC on Solana here"
        />
      )}
    </div>
  );
}
