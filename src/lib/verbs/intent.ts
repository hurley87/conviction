// Deterministic plain-English → constrained intent parser (ADR 0012).
// Fully mockable for CI (ADR 0014); a real LLM can front this seam later.

import type {
  ParseResult,
  ProductAsset,
  TradeIntent,
  UniversalBalance,
  ValidationResult,
} from "@/lib/verbs/types";
import { assetMatches } from "@/lib/verbs/assets";
import { formatUsd } from "@/lib/format";

const DEFAULT_DEST_CHAIN = "Arbitrum" as const;
const DEFAULT_TO_ASSET: ProductAsset = "cash";

const ASSET_ALIASES: Record<string, ProductAsset> = {
  cash: "cash",
  usd: "cash",
  dollars: "cash",
  money: "cash",
  usdc: "usdc",
  usdt: "usdt",
  eth: "eth",
  ethereum: "eth",
  btc: "btc",
  bitcoin: "btc",
  sol: "sol",
  solana: "sol",
};

const SUPPORTED_ASSETS = new Set<ProductAsset>([
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
]);

const CLARIFY_AMOUNT =
  "How much — all of it, or a set amount? For example: \"$25\" or \"half\".";

/** Map free text to a product asset label, or undefined if not found. */
export function parseAssetWord(text: string): ProductAsset | undefined {
  const normalized = text.toLowerCase().trim();
  return ASSET_ALIASES[normalized];
}

/** Extract dollar amount from text like "$25", "25 dollars", "25 usd". */
function parseDollarAmount(text: string): number | undefined {
  const dollarSign = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (dollarSign) {
    return parseFloat(dollarSign[1]!.replace(/,/g, ""));
  }
  const wordAmount = text.match(
    /\b([\d,]+(?:\.\d{1,2})?)\s*(?:dollars?|usd)\b/i,
  );
  if (wordAmount) {
    return parseFloat(wordAmount[1]!.replace(/,/g, ""));
  }
  return undefined;
}

/** Extract fraction from text like "all", "half", "25%", "quarter". */
function parseFraction(text: string): number | undefined {
  const lower = text.toLowerCase();
  if (/\ball\b/.test(lower) || /\beverything\b/.test(lower)) return 1;
  if (/\bhalf\b/.test(lower)) return 0.5;
  if (/\bquarter\b/.test(lower)) return 0.25;
  const pct = text.match(/\b(\d+(?:\.\d+)?)\s*%/);
  if (pct) return Math.min(1, parseFloat(pct[1]!) / 100);
  return undefined;
}

/** Detect "move/convert/sell X to cash" style from-asset hints. */
function parseFromAsset(text: string): ProductAsset | undefined {
  const fromMatch = text.match(
    /\b(?:move|convert|sell|swap|use|from)\s+(?:my\s+)?(\w+)/i,
  );
  if (fromMatch) {
    const asset = parseAssetWord(fromMatch[1]!);
    if (asset && asset !== "cash") return asset;
  }
  return undefined;
}

function parseToAsset(text: string): ProductAsset {
  const toMatch = text.match(
    /\b(?:to|into|for)\s+(?:my\s+)?(\w+)/i,
  );
  if (toMatch) {
    const asset = parseAssetWord(toMatch[1]!);
    if (asset) return asset;
  }
  if (/\b(?:cash out|to cash|into cash)\b/i.test(text)) return "cash";
  return DEFAULT_TO_ASSET;
}

/**
 * Map plain English to a constrained intent or a single clarifying question.
 * Never silently infers "all" when amount is missing (ADR 0012).
 */
export function parseIntent(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "clarify", question: CLARIFY_AMOUNT };
  }

  const sizeUsd = parseDollarAmount(trimmed);
  const fraction = sizeUsd == null ? parseFraction(trimmed) : undefined;
  const fromAsset = parseFromAsset(trimmed);
  const toAsset = parseToAsset(trimmed);

  if (sizeUsd == null && fraction == null) {
    return { kind: "clarify", question: CLARIFY_AMOUNT };
  }

  const intent: TradeIntent = {
    toAsset,
    destChain: DEFAULT_DEST_CHAIN,
  };
  if (fromAsset) intent.fromAsset = fromAsset;
  if (sizeUsd != null) intent.sizeUsd = sizeUsd;
  if (fraction != null) intent.fraction = fraction;

  return { kind: "intent", intent };
}

/** Resolve intent size to a concrete USD amount against the live balance. */
export function resolveSizeUsd(
  intent: TradeIntent,
  balance: UniversalBalance,
): number {
  if (intent.sizeUsd != null) return intent.sizeUsd;
  if (intent.fraction != null) return balance.totalUsd * intent.fraction;
  return 0;
}

/**
 * Validate intent against supported assets and live balance (ADR 0012).
 * The verb layer owns validation — not the LLM.
 */
export function validateIntent(
  intent: TradeIntent,
  balance: UniversalBalance,
): ValidationResult {
  if (!SUPPORTED_ASSETS.has(intent.toAsset)) {
    return { ok: false, error: "That destination isn't supported yet." };
  }
  if (intent.fromAsset && !SUPPORTED_ASSETS.has(intent.fromAsset)) {
    return { ok: false, error: "That asset isn't supported yet." };
  }

  // No-op guard: if every funded source is already the target asset on the
  // settlement chain, there's nothing to convert — the SDK would reject this as
  // a same-token buy (-32683). Surface a friendly message instead.
  const hasConvertibleFunds = balance.sources.some(
    (s) =>
      s.usd > 0 &&
      !(s.chain === intent.destChain && assetMatches(s.asset, intent.toAsset)),
  );
  if (!hasConvertibleFunds) {
    const label =
      intent.toAsset === "cash"
        ? "in cash"
        : `held as ${intent.toAsset.toUpperCase()}`;
    return {
      ok: false,
      error: `Your money is already ${label} — there's nothing to move.`,
    };
  }

  const sizeUsd = resolveSizeUsd(intent, balance);
  if (sizeUsd <= 0) {
    return { ok: false, error: "Please specify a positive amount." };
  }
  if (sizeUsd > balance.totalUsd) {
    return {
      ok: false,
      error: `You only have $${balance.totalUsd.toFixed(2)} available.`,
    };
  }

  if (intent.fromAsset) {
    const sourceUsd = balance.sources
      .filter((s) => assetMatches(s.asset, intent.fromAsset!))
      .reduce((acc, s) => acc + s.usd, 0);
    if (sourceUsd <= 0) {
      return { ok: false, error: "You don't hold any of that asset." };
    }
    if (sizeUsd > sourceUsd) {
      return {
        ok: false,
        error: `You only have $${sourceUsd.toFixed(2)} of that available.`,
      };
    }
  }

  return { ok: true, intent, sizeUsd };
}

/** Plain-English narration for a completed trade (no chain/token jargon). */
export function narrateResult(dollarsIn: number, dollarsOut: number): string {
  return `Done — ${formatUsd(dollarsIn)} moved. You now have ${formatUsd(dollarsOut)} in cash.`;
}
