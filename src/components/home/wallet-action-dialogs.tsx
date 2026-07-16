"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { GHOST_LIGHT, PRIMARY_LIGHT } from "@/components/button-styles";
import {
  buildReceiveRequest,
  type ReceiveNetwork,
} from "@/lib/receive-request";
import type { DepositAddresses } from "@/lib/verbs/types";

type WalletNetwork = {
  name: ReceiveNetwork;
  address: string;
  color: string;
  mark: string;
};

function walletNetworks(deposits: DepositAddresses): WalletNetwork[] {
  const networks: WalletNetwork[] = [
    {
      name: "Base",
      address: deposits.evm,
      color: "#0052ff",
      mark: "B",
    },
    {
      name: "Arbitrum",
      address: deposits.evm,
      color: "#213147",
      mark: "A",
    },
  ];
  if (deposits.solana) {
    networks.push({
      name: "Solana",
      address: deposits.solana,
      color: "#087f65",
      mark: "S",
    });
  }
  return networks;
}

function NetworkSelector({
  networks,
  value,
  onChange,
}: {
  networks: WalletNetwork[];
  value: ReceiveNetwork;
  onChange: (network: ReceiveNetwork) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {networks.map((network) => {
        const active = network.name === value;
        return (
          <button
            key={network.name}
            type="button"
            onClick={() => onChange(network.name)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-[16px] border px-3 py-3 text-left text-sm font-bold transition ${
              active
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface-2/70 text-ink-2 hover:border-line-strong hover:bg-surface-2"
            }`}
          >
            <span
              className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black text-white"
              style={{ backgroundColor: network.color }}
              aria-hidden
            >
              {network.mark}
            </span>
            {network.name}
          </button>
        );
      })}
    </div>
  );
}

function AddressQr({ address }: { address: string }) {
  return (
    <div className="mx-auto w-fit rounded-[24px] border border-line bg-white p-4 shadow-sm">
      <QRCodeSVG
        value={address}
        size={210}
        level="M"
        marginSize={1}
        aria-label="Wallet address QR code"
      />
    </div>
  );
}

function useCopyFeedback() {
  const [copied, setCopied] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(null), 1600);
  };

  return { copied, copy };
}

function AddressBlock({
  address,
  copied,
  onCopy,
}: {
  address: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      title={address}
      onClick={onCopy}
      className="flex w-full items-center gap-3 rounded-[18px] bg-ink px-4 py-3.5 text-left text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
        className="shrink-0"
      >
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span className="min-w-0 flex-1 break-all font-mono text-sm">
        {address}
      </span>
      <span className="shrink-0 text-xs font-bold text-white/70">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

export function DepositDialogContent({
  deposits,
}: {
  deposits: DepositAddresses | null;
}) {
  const { copied, copy } = useCopyFeedback();
  const networks = useMemo(
    () => (deposits ? walletNetworks(deposits) : []),
    [deposits],
  );
  const [selected, setSelected] = useState<ReceiveNetwork>("Base");
  const network =
    networks.find((candidate) => candidate.name === selected) ?? networks[0];

  if (!deposits || !network) {
    return (
      <p className="py-12 text-center text-sm text-ink-3">
        Loading your deposit address…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-bold text-ink-3">Network</p>
        <NetworkSelector
          networks={networks}
          value={network.name}
          onChange={setSelected}
        />
      </div>

      <AddressQr address={network.address} />
      <AddressBlock
        address={network.address}
        copied={copied === "address"}
        onCopy={() => void copy("address", network.address)}
      />

      <p className="rounded-[16px] border border-warning/20 bg-[#fff6df] p-3 text-xs leading-relaxed text-warning">
        Send only USDC on {network.name} to this address. Using another asset
        or network may permanently lose funds.
      </p>
    </div>
  );
}

export function ReceiveDialogContent({
  deposits,
}: {
  deposits: DepositAddresses | null;
}) {
  const { copied, copy } = useCopyFeedback();
  const networks = useMemo(
    () => (deposits ? walletNetworks(deposits) : []),
    [deposits],
  );
  const [selected, setSelected] = useState<ReceiveNetwork>("Base");
  const [amountRaw, setAmountRaw] = useState("");
  const [shared, setShared] = useState(false);
  const network =
    networks.find((candidate) => candidate.name === selected) ?? networks[0];
  const request = network
    ? buildReceiveRequest({
        amountRaw,
        network: network.name,
        address: network.address,
      })
    : null;

  if (!deposits || !network || !request) {
    return (
      <p className="py-12 text-center text-sm text-ink-3">
        Loading your receive address…
      </p>
    );
  }

  const shareRequest = async () => {
    if (!request.ok) return;
    setShared(false);
    if (navigator.share) {
      try {
        await navigator.share({
          title: "USDC payment request",
          text: request.text,
        });
        setShared(true);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy("request", request.text);
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-bold text-ink-3">Network</p>
        <NetworkSelector
          networks={networks}
          value={network.name}
          onChange={setSelected}
        />
      </div>

      <label className="block">
        <span className="text-xs font-bold text-ink-3">
          Amount in USDC <span className="font-normal text-ink-4">(optional)</span>
        </span>
        <div className="app-input mt-1 flex items-center rounded-[16px] px-4 py-3">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amountRaw}
            onChange={(event) => {
              setAmountRaw(event.target.value);
              setShared(false);
            }}
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums outline-none"
          />
          <span className="text-sm font-bold text-ink-3">USDC</span>
        </div>
      </label>

      <AddressQr address={network.address} />

      {request.ok ? (
        <p className="rounded-[18px] bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
          {request.text}
        </p>
      ) : (
        <p className="text-xs text-danger" role="alert">
          {request.error}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void copy("address", network.address)}
          className={`${GHOST_LIGHT} px-4 text-sm`}
        >
          {copied === "address" ? "Address copied" : "Copy address"}
        </button>
        <button
          type="button"
          disabled={!request.ok}
          onClick={() => {
            if (request.ok) void copy("request", request.text);
          }}
          className={`${GHOST_LIGHT} px-4 text-sm`}
        >
          {copied === "request" ? "Request copied" : "Copy request"}
        </button>
      </div>
      <button
        type="button"
        disabled={!request.ok}
        onClick={() => void shareRequest()}
        className={`${PRIMARY_LIGHT} w-full text-sm`}
      >
        {shared ? "Shared" : "Share request"}
      </button>
    </div>
  );
}
