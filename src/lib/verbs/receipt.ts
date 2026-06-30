// Map UA transaction results to receipt legs with explorer links (ADR 0013).

import { chainName, explorerUrl } from "@/lib/verbs/chains";
import { formatUsd } from "@/lib/format";
import type { Receipt, ReceiptLeg } from "@/lib/verbs/types";

/** Per-chain userOps from a UA transaction (carry the explorer-linkable hash). */
export type RawUserOps = { chainId: number; userOpHash?: string }[] | undefined;

/** Net amounts for the receipt — sourced from the executed quote, since the
 * SDK's getTransaction status object does not carry the USD totals. */
export type ReceiptAmounts = {
  dollarsIn: number;
  dollarsOut: number;
  feeUsd: number;
  sourceChain: string;
  destChain: string;
};

/** Build receipt legs from per-chain userOp hashes. */
export function legsFromUserOps(userOps: RawUserOps): ReceiptLeg[] {
  if (!userOps?.length) return [];
  return userOps
    .filter((op) => op.userOpHash)
    .map((op) => ({
      chain: chainName(op.chainId),
      txHash: op.userOpHash!,
      explorerUrl: explorerUrl(op.chainId, op.userOpHash!),
    }));
}

/** Plain net summary for the receipt (ADR 0013). */
export function buildReceiptSummary(
  dollarsIn: number,
  dollarsOut: number,
  sourceChain: string,
  destChain: string,
): string {
  return `${formatUsd(dollarsIn)} from ${sourceChain} → ${formatUsd(dollarsOut)} USDC on ${destChain}`;
}

/** Assemble a full Receipt from the executed quote's amounts + per-chain legs. */
export function buildReceipt(
  slug: string,
  amounts: ReceiptAmounts,
  userOps: RawUserOps,
): Receipt {
  return {
    slug,
    legs: legsFromUserOps(userOps),
    summary: buildReceiptSummary(
      amounts.dollarsIn,
      amounts.dollarsOut,
      amounts.sourceChain,
      amounts.destChain,
    ),
    dollarsIn: amounts.dollarsIn,
    dollarsOut: amounts.dollarsOut,
    feeUsd: amounts.feeUsd,
  };
}

/** Generate a short shareable slug for a receipt permalink. */
export function generateReceiptSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
