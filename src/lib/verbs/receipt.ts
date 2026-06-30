// Map UA transaction results to receipt legs with explorer links (ADR 0013).

import { ARBITRUM_CHAIN_ID, chainName, explorerUrl } from "@/lib/verbs/chains";
import { parseUsd, type RawTokenChanges } from "@/lib/verbs/quote";
import { formatUsd } from "@/lib/format";
import type { Receipt, ReceiptLeg } from "@/lib/verbs/types";

/** Minimal structural subset of a completed UA transaction. */
export type RawCompletedTx = {
  transactionId?: string;
  userOps?: {
    chainId: number;
    userOpHash?: string;
  }[];
  tokenChanges?: RawTokenChanges;
};

/** Build receipt legs from per-chain userOp hashes. */
export function legsFromUserOps(
  userOps: RawCompletedTx["userOps"],
): ReceiptLeg[] {
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

/** Assemble a full Receipt from a completed UA transaction. */
export function buildReceipt(
  slug: string,
  tx: RawCompletedTx,
): Receipt {
  const changes = tx.tokenChanges ?? {};
  const dollarsIn = parseUsd(changes.totalDecrAmountInUSD);
  const dollarsOut = parseUsd(changes.totalIncrAmountInUSD);
  const feeUsd = parseUsd(changes.totalFeeInUSD);
  const sourceChain = chainName(changes.decr?.[0]?.token?.chainId);
  const destChain = chainName(
    changes.incr?.[0]?.token?.chainId ?? ARBITRUM_CHAIN_ID,
  );

  return {
    slug,
    legs: legsFromUserOps(tx.userOps),
    summary: buildReceiptSummary(dollarsIn, dollarsOut, sourceChain, destChain),
    dollarsIn,
    dollarsOut,
    feeUsd,
  };
}

/** Generate a short shareable slug for a receipt permalink. */
export function generateReceiptSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
