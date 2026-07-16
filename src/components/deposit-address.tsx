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
    <div className="flex flex-col items-start gap-1.5 rounded-[18px] border border-line bg-surface-2/70 p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-ink-4">
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
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 font-mono text-sm text-ink shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        {truncateAddress(address)}
        <span className="rounded-full bg-brand-soft px-2 py-1 font-body text-[10px] font-extrabold text-brand">
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <p className="text-xs text-ink-4">{hint}</p>
    </div>
  );
}

export function DepositAddress({ deposits }: { deposits: DepositAddresses }) {
  return (
    <div className="grid gap-3">
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
