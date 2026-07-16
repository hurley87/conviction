export type ReceiveNetwork = "Base" | "Arbitrum" | "Solana";

export function normalizeReceiveAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return trimmed.replace(/^0+(?=\d)/, "");
}

export function buildReceiveRequest(input: {
  amountRaw: string;
  network: ReceiveNetwork;
  address: string;
}): { ok: true; text: string } | { ok: false; error: string } {
  const amount = normalizeReceiveAmount(input.amountRaw);
  if (amount == null) {
    return {
      ok: false,
      error: "Enter a positive USDC amount with up to 6 decimal places.",
    };
  }
  const amountLabel = amount ? `${amount} ` : "";
  return {
    ok: true,
    text: `Send me ${amountLabel}USDC on ${input.network} to ${input.address}.`,
  };
}
