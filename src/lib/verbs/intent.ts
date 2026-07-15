// Deterministic plain-English → constrained intent parser (ADR 0012).
// Fully mockable for CI (ADR 0014); a real LLM can front this seam later.

import type {
  DestChain,
  ParseResult,
  ProductAsset,
  TradeIntent,
  UniversalBalance,
  ValidationResult,
} from "@/lib/verbs/types";
import {
  assetMatches,
  isBuyOnlyAsset,
  productAssetPrimarySymbol,
  toUaTokenType,
} from "@/lib/verbs/assets";
import {
  SETTLEMENT_CHAINS,
  destChainFromId,
  destChainId,
  tokenAddress,
} from "@/lib/verbs/chains";
import { formatUsd } from "@/lib/format";

export const DEFAULT_DEST_CHAIN = "Arbitrum" as const;
export const DEFAULT_TO_ASSET: ProductAsset = "cash";

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
  // Deliberately no "arbitrum" alias — that word names the chain in phrases
  // like "cash on Arbitrum" and must not be read as the ARB token.
  arb: "arb",
};

const SUPPORTED_ASSETS = new Set<ProductAsset>([
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
  "arb",
]);

export const CLARIFY_AMOUNT =
  "How much — all of it, or a set amount? For example: \"$25\" or \"half\".";

/** Product assets the parser is allowed to emit (ADR 0012 constrained set). */
export const PARSER_ASSETS: ProductAsset[] = [...SUPPORTED_ASSETS];

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

const DEST_CHAIN_WORDS: Record<string, DestChain> = {
  arbitrum: "Arbitrum",
  arb: "Arbitrum",
  base: "Base",
};

function parseToAsset(text: string): ProductAsset {
  // "buy/get ETH", "buy $20 of ETH", "buy 0.5 of ETH" — the asset being
  // acquired is the dest. Allow an optional dollar amount between the verb
  // and the asset so money-shot phrasing still parses.
  const buyMatch = text.match(
    /\b(?:buy|buying|get|acquire|purchase)\s+(?:\$?\s*[\d.,]+\s+)?(?:of\s+)?(?:my\s+)?(\w+)/i,
  );
  if (buyMatch) {
    const asset = parseAssetWord(buyMatch[1]!);
    if (asset) return asset;
  }

  // "to/into/for/on <asset>" names the destination — "spend half on ETH",
  // "move $25 to cash". ("on" stays out of parseFromAsset, so "cash in" /
  // "sell on" don't get misread as a buy.) Skip chain words — those are
  // settlement via parseExplicitDestChain, not assets. "arb" is the token
  // only via buy/get phrasing; "on ARB" means the Arbitrum chain.
  const toMatch = text.match(
    /\b(?:to|into|for|on)\s+(?:my\s+)?(\w+)/i,
  );
  if (toMatch) {
    const word = toMatch[1]!.toLowerCase();
    if (!(word in DEST_CHAIN_WORDS)) {
      const asset = parseAssetWord(word);
      if (asset) return asset;
    }
  }
  if (/\b(?:cash out|to cash|into cash)\b/i.test(text)) return "cash";
  return DEFAULT_TO_ASSET;
}

/**
 * Detect an explicit settlement chain in plain English ("on Arbitrum",
 * "on ARB", "settle on Base"). Used for the desk/demo money shot: Base-funded
 * buy of ETH that must land on Arbitrum (ADR 0005 + Particle cross-chain
 * proof). Returns undefined when the user did not name a chain — callers then
 * use pickSettlementChain.
 */
export function parseExplicitDestChain(text: string): DestChain | undefined {
  const match = text.match(
    /\b(?:settle(?:s|d|ing)?\s+)?(?:on|onto|to)\s+(arbitrum|arb|base)\b/i,
  );
  if (!match) return undefined;
  return DEST_CHAIN_WORDS[match[1]!.toLowerCase()];
}

/**
 * Deterministic plain-English → intent parser. Fully offline and the CI test
 * target (ADR 0014); also the fallback when the LLM gateway is unavailable.
 * Never silently infers "all" when amount is missing (ADR 0012).
 * Only sets destChain when the user named a chain; otherwise leave it unset
 * so the caller can pickSettlementChain from live balance.
 */
export function parseIntentHeuristic(text: string): ParseResult {
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

  const intent: TradeIntent = { toAsset };
  const destChain = parseExplicitDestChain(trimmed);
  if (destChain) intent.destChain = destChain;
  if (fromAsset) intent.fromAsset = fromAsset;
  if (sizeUsd != null) intent.sizeUsd = sizeUsd;
  if (fraction != null) intent.fraction = fraction;

  return { kind: "intent", intent };
}

/**
 * Choose the chain a trade should settle on. Cash stays on Arbitrum (ADR 0005 —
 * the canonical cash location). A crypto buy settles on the supported chain that
 * holds the most convertible funds, so we don't bridge just to swap; falls back
 * to Arbitrum when nothing is funded on a candidate chain.
 */
export function pickSettlementChain(
  toAsset: ProductAsset,
  balance: UniversalBalance,
): DestChain {
  if (toAsset === "cash") return DEFAULT_DEST_CHAIN;

  const uaTokenType = toUaTokenType(toAsset);
  const candidates = SETTLEMENT_CHAINS.filter((c) =>
    tokenAddress(uaTokenType, destChainId(c)),
  );
  if (candidates.length === 0) return DEFAULT_DEST_CHAIN;

  let best = candidates.includes(DEFAULT_DEST_CHAIN)
    ? DEFAULT_DEST_CHAIN
    : candidates[0]!;
  let bestUsd = 0;
  for (const chain of candidates) {
    const usd = balance.sources
      .filter((s) => s.chain === chain)
      .reduce((acc, s) => acc + s.usd, 0);
    if (usd > bestUsd) {
      bestUsd = usd;
      best = chain;
    }
  }
  return best;
}

/** Sum the USD held in a specific product asset across all chains. */
function assetSliceUsd(
  balance: UniversalBalance,
  asset: ProductAsset,
): number {
  return balance.sources
    .filter((s) => assetMatches(s.asset, asset))
    .reduce((acc, s) => acc + s.usd, 0);
}

/**
 * Resolve intent size to a concrete USD amount against the live balance. A
 * fraction applies to the *source asset* when one is named ("half my ETH" = half
 * of the ETH held), otherwise to the whole unified balance ("half" = half of
 * everything).
 */
export function resolveSizeUsd(
  intent: TradeIntent,
  balance: UniversalBalance,
): number {
  if (intent.sizeUsd != null) return intent.sizeUsd;
  if (intent.fraction != null) {
    const base =
      intent.fromAsset != null
        ? assetSliceUsd(balance, intent.fromAsset)
        : balance.totalUsd;
    return base * intent.fraction;
  }
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
  if (!intent.destChain) {
    return { ok: false, error: "Settlement chain required." };
  }
  const destChain = intent.destChain;

  if (intent.token) {
    // Concrete-token intents (deck cards) bypass the product-asset table;
    // routability is proven at quote time via the warm-up flow.
    if (intent.toAsset !== "token") {
      return { ok: false, error: "That destination isn't supported yet." };
    }
    const tokenChain = destChainFromId(intent.token.chainId);
    if (!tokenChain || tokenChain !== destChain) {
      return {
        ok: false,
        error: `${intent.token.symbol} lives on a chain we can't settle on yet.`,
      };
    }
    if (intent.fromAsset) {
      return {
        ok: false,
        error: `Buy ${intent.token.symbol} with cash instead — converting another asset into it isn't supported yet.`,
      };
    }
  } else {
    if (intent.toAsset === "token" || !SUPPORTED_ASSETS.has(intent.toAsset)) {
      return { ok: false, error: "That destination isn't supported yet." };
    }
    if (intent.fromAsset && !SUPPORTED_ASSETS.has(intent.fromAsset)) {
      return { ok: false, error: "That asset isn't supported yet." };
    }

    // Buy-only assets (e.g. ARB) aren't UA primary tokens: they can't fund a
    // trade (usePrimaryTokens) or be a convert destination (expectToken.type).
    if (intent.fromAsset && isBuyOnlyAsset(intent.fromAsset)) {
      return {
        ok: false,
        error: `${intent.fromAsset.toUpperCase()} can only be bought for now, not sold.`,
      };
    }
    if (intent.fromAsset && isBuyOnlyAsset(intent.toAsset)) {
      return {
        ok: false,
        error: `Buy ${intent.toAsset.toUpperCase()} with cash instead — converting another asset into it isn't supported yet.`,
      };
    }

    // The target must have a known address on the settlement chain. Catches
    // assets like SOL (not an EVM chain) before quoting, with a friendly message
    // instead of a jargon error from the trade builder.
    if (!tokenAddress(toUaTokenType(intent.toAsset), destChainId(destChain))) {
      return { ok: false, error: "That destination isn't supported yet." };
    }

    // No-op guard: if every funded source is already the target asset on the
    // settlement chain, there's nothing to convert — the SDK would reject this as
    // a same-token buy (-32683). Surface a friendly message instead. (Concrete
    // tokens skip this: they're never a primary-balance asset.)
    const hasConvertibleFunds = balance.sources.some(
      (s) =>
        s.usd > 0 &&
        !(s.chain === destChain && assetMatches(s.asset, intent.toAsset)),
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
    const sourceUsd = assetSliceUsd(balance, intent.fromAsset);
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

/** Plain-English narration for a completed trade, naming the real token the
 * user now holds (e.g. USDC for cash). */
export function narrateResult(
  dollarsIn: number,
  dollarsOut: number,
  toAsset: ProductAsset,
  receivedSymbol?: string,
): string {
  const symbol = receivedSymbol ?? productAssetPrimarySymbol(toAsset);
  return `Done — ${formatUsd(dollarsIn)} moved. You now have ${formatUsd(dollarsOut)} in ${symbol}.`;
}
