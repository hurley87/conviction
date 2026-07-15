// Map UA transaction results to receipt legs with explorer links (ADR 0013).

import { chainName, explorerUrl } from "@/lib/verbs/chains";
import { productAssetPrimarySymbol } from "@/lib/verbs/assets";
import { formatUsd } from "@/lib/format";
import type {
  ProductAsset,
  Receipt,
  ReceiptLeg,
  TradeIntent,
} from "@/lib/verbs/types";

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
  /** Destination product asset — fallback when the on-chain symbol is absent. */
  toAsset: ProductAsset;
  /** The token actually received on-chain (e.g. "wstETH"), when known. */
  receivedSymbol?: string;
  /** Token spent (e.g. USDC for a cash-funded buy). */
  sourceSymbol?: string;
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

/**
 * Prefer a leg chain that isn't the destination — userOps are the ground truth
 * for cross-chain moves when the quote's sourceChain was mis-ordered.
 */
export function resolveReceiptSourceChain(
  quotedSource: string,
  destChain: string,
  legs: ReceiptLeg[],
): string {
  const foreign = legs.find((leg) => leg.chain !== destChain);
  if (foreign) return foreign.chain;
  if (quotedSource && quotedSource !== "Unknown") return quotedSource;
  return legs[0]?.chain ?? quotedSource;
}

/** Spent-token label for the receipt: explicit fromAsset, else USDC (cash). */
export function inferSpentSymbol(intent: TradeIntent): string {
  if (intent.fromAsset) {
    return productAssetPrimarySymbol(intent.fromAsset);
  }
  return "USDC";
}

/** Plain net summary for the receipt (ADR 0013). Names spent + received tokens
 * and makes source ≠ dest self-evident when the move was cross-chain. */
export function buildReceiptSummary(
  dollarsIn: number,
  dollarsOut: number,
  sourceChain: string,
  destChain: string,
  destSymbol: string,
  sourceSymbol = "USDC",
): string {
  return `${formatUsd(dollarsIn)} ${sourceSymbol} from ${sourceChain} → ${formatUsd(dollarsOut)} ${destSymbol} on ${destChain}`;
}

/** Assemble a full Receipt from the executed quote's amounts + per-chain legs. */
export function buildReceipt(
  slug: string,
  amounts: ReceiptAmounts,
  userOps: RawUserOps,
): Receipt {
  const legs = legsFromUserOps(userOps);
  const sourceChain = resolveReceiptSourceChain(
    amounts.sourceChain,
    amounts.destChain,
    legs,
  );
  return {
    slug,
    legs,
    summary: buildReceiptSummary(
      amounts.dollarsIn,
      amounts.dollarsOut,
      sourceChain,
      amounts.destChain,
      amounts.receivedSymbol ?? productAssetPrimarySymbol(amounts.toAsset),
      amounts.sourceSymbol,
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
