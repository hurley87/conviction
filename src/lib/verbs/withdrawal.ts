// Pure withdrawal validation and quote shaping. SDK-free so unit tests cover
// destination / amount / pair edge cases without live Particle (ADR 0014).

import { getAddress, isAddress, ZeroAddress } from "ethers";
import {
  assetMatches,
  productAssetPrimarySymbol,
  toUaTokenType,
} from "@/lib/verbs/assets";
import { destChainId, tokenAddress } from "@/lib/verbs/chains";
import {
  extractFeeUsd,
  parseUsd,
  type RawTokenChanges,
} from "@/lib/verbs/quote";
import type {
  DestChain,
  UniversalBalance,
  WithdrawalAsset,
  WithdrawalQuote,
  WithdrawalRequest,
} from "@/lib/verbs/types";

/** Max debit increase at execute vs the agreed quote before requiring reconfirm. */
export const WITHDRAWAL_DEBIT_TOLERANCE = 0.01;

/** Supported external-send assets. */
export const WITHDRAWAL_ASSETS: WithdrawalAsset[] = ["usdc", "usdt", "eth"];

/** Decimal places accepted for human-readable token amounts. */
const MAX_DECIMALS: Record<WithdrawalAsset, number> = {
  usdc: 6,
  usdt: 6,
  eth: 18,
};

type ValidationOk = { ok: true; request: WithdrawalRequest };
type ValidationErr = { ok: false; error: string };
export type WithdrawalValidationResult = ValidationOk | ValidationErr;

/** Chains that accept withdrawals of the given primary asset. */
export function supportedWithdrawalChains(
  asset: WithdrawalAsset,
): DestChain[] {
  if (asset === "usdt") return ["Arbitrum"];
  return ["Arbitrum", "Base"];
}

/** True when the asset/network pair is a withdrawable primary destination. */
export function isSupportedWithdrawalPair(
  asset: WithdrawalAsset,
  destChain: DestChain,
): boolean {
  return supportedWithdrawalChains(asset).includes(destChain);
}

/** Resolve the token contract for a withdrawal destination, if supported. */
export function withdrawalTokenRef(
  asset: WithdrawalAsset,
  destChain: DestChain,
): { chainId: number; address: string } | null {
  if (!isSupportedWithdrawalPair(asset, destChain)) return null;
  const chainId = destChainId(destChain);
  const address = tokenAddress(toUaTokenType(asset), chainId);
  if (!address) return null;
  return { chainId, address };
}

/** Display ticker for a withdrawal asset. */
export function withdrawalAssetLabel(asset: WithdrawalAsset): string {
  return productAssetPrimarySymbol(asset);
}

/**
 * Parse a human-readable token amount. Rejects empty, non-finite, ≤0, and
 * excess fractional precision (e.g. 7 decimals for USDC).
 */
export function parseTokenAmount(
  raw: string,
  asset: WithdrawalAsset,
): { ok: true; amount: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter an amount to send." };
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid number." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  const frac = trimmed.includes(".") ? trimmed.split(".")[1]! : "";
  if (frac.length > MAX_DECIMALS[asset]) {
    return {
      ok: false,
      error: `${withdrawalAssetLabel(asset)} allows at most ${MAX_DECIMALS[asset]} decimal places.`,
    };
  }
  // Strip leading zeros while preserving fractional form the user typed.
  const normalized = trimmed.includes(".")
    ? `${String(BigInt(trimmed.split(".")[0] || "0"))}.${frac}`
    : String(BigInt(trimmed));
  return { ok: true, amount: normalized };
}

/** Sum unified-balance USD for sources matching the withdrawal asset. */
export function availableUsdForAsset(
  balance: UniversalBalance | null | undefined,
  asset: WithdrawalAsset,
): number {
  if (!balance) return 0;
  return balance.sources
    .filter((source) => assetMatches(source.asset, asset))
    .reduce((sum, source) => sum + source.usd, 0);
}

/** Validate destination + amount + pair; returns a normalized request. */
export function validateWithdrawal(input: {
  asset: WithdrawalAsset;
  destChain: DestChain;
  amountRaw: string;
  destinationRaw: string;
  ownerAddress: string | null | undefined;
  balance: UniversalBalance | null | undefined;
}): WithdrawalValidationResult {
  const { asset, destChain, amountRaw, destinationRaw, ownerAddress, balance } =
    input;

  if (!isSupportedWithdrawalPair(asset, destChain)) {
    return {
      ok: false,
      error: `${withdrawalAssetLabel(asset)} withdrawals are not available on ${destChain}.`,
    };
  }
  if (!withdrawalTokenRef(asset, destChain)) {
    return {
      ok: false,
      error: `No ${withdrawalAssetLabel(asset)} token on ${destChain}.`,
    };
  }

  const destTrimmed = destinationRaw.trim();
  if (!destTrimmed) {
    return { ok: false, error: "Enter a wallet address." };
  }
  if (!isAddress(destTrimmed)) {
    return { ok: false, error: "Enter a valid Ethereum wallet address." };
  }
  let destination: string;
  try {
    destination = getAddress(destTrimmed);
  } catch {
    return { ok: false, error: "Enter a valid Ethereum wallet address." };
  }
  if (destination === ZeroAddress) {
    return { ok: false, error: "Cannot send to the zero address." };
  }
  if (ownerAddress && isAddress(ownerAddress)) {
    if (getAddress(ownerAddress) === destination) {
      return {
        ok: false,
        error: "Enter an external wallet — not your Conviction address.",
      };
    }
  }

  const parsed = parseTokenAmount(amountRaw, asset);
  if (!parsed.ok) return parsed;

  const available = availableUsdForAsset(balance, asset);
  // Stables are ~1:1 with USD in the unified balance — catch obvious overdrafts
  // before quoting. ETH uses a soft "have some ETH" check; the quote is authoritative.
  if (asset === "usdc" || asset === "usdt") {
    if (Number(parsed.amount) > available + 1e-9) {
      return {
        ok: false,
        error: `You only have about $${available.toFixed(2)} in ${withdrawalAssetLabel(asset)}.`,
      };
    }
  } else if (available <= 0) {
    return {
      ok: false,
      error: `No ${withdrawalAssetLabel(asset)} available to send.`,
    };
  }

  return {
    ok: true,
    request: {
      asset,
      destChain,
      amount: parsed.amount,
      destination,
    },
  };
}

/** Maximum debit the user agreed to for this quote. */
export function computeMaxDebit(
  estimatedDebitUsd: number,
  tolerance = WITHDRAWAL_DEBIT_TOLERANCE,
): number {
  return estimatedDebitUsd * (1 + tolerance);
}

/** True when a fresh quote debit exceeds the agreed ceiling. */
export function isAboveMaxDebit(
  freshDebitUsd: number,
  maxDebitUsd: number,
): boolean {
  return freshDebitUsd > maxDebitUsd;
}

/** Map SDK tokenChanges into a jargon-light WithdrawalQuote. */
export function shapeWithdrawalQuote(
  changes: RawTokenChanges,
  request: WithdrawalRequest,
  transactionId: string,
  rawTransaction: unknown,
  etaSeconds = 45,
): WithdrawalQuote {
  const amountNum = Number(request.amount);
  const estimatedDebitUsd = parseUsd(
    changes.totalDecrAmountInUSD,
    amountNum,
  );
  let feeUsd = extractFeeUsd(rawTransaction);
  if (feeUsd == null) {
    const reported = parseUsd(changes.totalFeeInUSD);
    feeUsd = reported > 0 ? reported : 0;
  }

  return {
    asset: request.asset,
    destChain: request.destChain,
    amount: request.amount,
    destination: request.destination,
    estimatedDebitUsd,
    feeUsd,
    maxDebitUsd: computeMaxDebit(estimatedDebitUsd),
    etaSeconds,
    transactionId,
    rawTransaction,
  };
}

/** Withdrawal request fields carried on a confirmed quote. */
export function requestFromQuote(quote: WithdrawalQuote): WithdrawalRequest {
  return {
    asset: quote.asset,
    destChain: quote.destChain,
    amount: quote.amount,
    destination: quote.destination,
  };
}

/** Short summary for activity timeline after a successful send. */
export function narrateWithdrawal(request: WithdrawalRequest): string {
  return `Sent ${request.amount} ${withdrawalAssetLabel(request.asset)} to ${request.destination.slice(0, 6)}…${request.destination.slice(-4)}`;
}

/** Stable activity id for a Particle transfer — insert-once, never overwrites. */
export function sendActivityId(transactionId: string): string {
  return `send:${transactionId}`;
}
