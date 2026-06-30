// postConviction verb — build feed entries from a completed trade (issue #4).

import type {
  ConvictionEntry,
  ConvictionTrade,
  ProductAsset,
  Receipt,
  TradeIntent,
  TradeQuote,
} from "@/lib/verbs/types";

export type BuildConvictionInput = {
  handle: string;
  thesis: string;
  trade: ConvictionTrade;
  receiptSlug?: string;
};

/** Generate a short unique id for a conviction feed entry. */
export function generateConvictionEntryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Assemble a conviction entry with denormalized handle (ADR 0009). */
export function buildConviction({
  handle,
  thesis,
  trade,
  receiptSlug,
}: BuildConvictionInput): ConvictionEntry {
  return {
    entryId: generateConvictionEntryId(),
    handle,
    thesis: thesis.trim(),
    trade,
    createdAt: new Date().toISOString(),
    backedBy: [],
    ...(receiptSlug ? { receiptSlug } : {}),
  };
}

const PRODUCT_ASSETS = new Set<ProductAsset>([
  "cash",
  "eth",
  "usdc",
  "usdt",
  "btc",
  "sol",
]);

function isProductAsset(value: unknown): value is ProductAsset {
  return typeof value === "string" && PRODUCT_ASSETS.has(value as ProductAsset);
}

/** Map a completed trade into conviction trade metadata. */
export function tradeToConvictionTrade(
  intent: TradeIntent,
  quote: TradeQuote,
  sizeUsd: number,
  receipt?: Receipt | null,
): ConvictionTrade {
  const fromChain =
    receipt?.legs[0]?.chain ?? quote.sourceChain ?? "Unknown";
  const fromAsset = intent.fromAsset ?? inferFromAsset(intent.toAsset);

  return {
    fromAsset,
    fromChain,
    toAsset: intent.toAsset,
    toChain: intent.destChain,
    sizeUsd,
  };
}

/** When the user didn't specify a source asset, infer a plausible opposite. */
function inferFromAsset(toAsset: ProductAsset): ProductAsset {
  if (toAsset === "cash") return "eth";
  return "cash";
}

/** Validate a conviction trade payload from the API. */
export function parseConvictionTrade(
  trade: unknown,
): ConvictionTrade | null {
  if (!trade || typeof trade !== "object") return null;
  const t = trade as Record<string, unknown>;
  if (
    !isProductAsset(t.fromAsset) ||
    !isProductAsset(t.toAsset) ||
    typeof t.fromChain !== "string" ||
    typeof t.toChain !== "string" ||
    typeof t.sizeUsd !== "number" ||
    t.sizeUsd <= 0
  ) {
    return null;
  }
  return {
    fromAsset: t.fromAsset,
    fromChain: t.fromChain,
    toAsset: t.toAsset,
    toChain: t.toChain as ConvictionTrade["toChain"],
    sizeUsd: t.sizeUsd,
  };
}
