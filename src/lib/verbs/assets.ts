// Single source of product-asset knowledge: the UA token type each product
// maps to, and the balance symbols that count as that product (including
// wrapped variants). Both the intent validator and the trade payload builder
// read from here so adding an asset or alias is a one-line table edit.

import type { ProductAsset } from "@/lib/verbs/types";

type AssetInfo = {
  /** UA SUPPORTED_TOKEN_TYPE string (or our own key for buy-only tokens). */
  uaTokenType: string;
  /** Balance symbols (uppercase) that satisfy this product. */
  matchSymbols: string[];
  /** Not a UA primary token: valid as a buy target (createBuyTransaction takes
   * its address directly) but can't fund a trade or be a convert destination. */
  buyOnly?: true;
};

const ASSETS: Record<ProductAsset, AssetInfo> = {
  cash: { uaTokenType: "usdc", matchSymbols: ["USDC", "USDT"] },
  usdc: { uaTokenType: "usdc", matchSymbols: ["USDC"] },
  usdt: { uaTokenType: "usdt", matchSymbols: ["USDT"] },
  eth: { uaTokenType: "eth", matchSymbols: ["ETH", "WETH"] },
  btc: { uaTokenType: "btc", matchSymbols: ["BTC", "WBTC"] },
  sol: { uaTokenType: "sol", matchSymbols: ["SOL"] },
  arb: { uaTokenType: "arb", matchSymbols: ["ARB"], buyOnly: true },
};

/** True when a string is one of the known product assets. */
export function isProductAsset(value: unknown): value is ProductAsset {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ASSETS, value)
  );
}

/** Map product asset to UA SUPPORTED_TOKEN_TYPE string. */
export function toUaTokenType(asset: ProductAsset): string {
  return ASSETS[asset]?.uaTokenType ?? "usdc";
}

/** True when an asset can only be bought, never sold or converted into. */
export function isBuyOnlyAsset(asset: ProductAsset): boolean {
  return ASSETS[asset]?.buyOnly === true;
}

/** True when a balance symbol satisfies the requested product asset. */
export function assetMatches(symbol: string, product: ProductAsset): boolean {
  return ASSETS[product]?.matchSymbols.includes(symbol.toUpperCase()) ?? false;
}

/** Primary ticker for feed token display (LI.FI lookup). */
export function productAssetPrimarySymbol(asset: ProductAsset): string {
  const symbols: Record<ProductAsset, string> = {
    cash: "USDC",
    usdc: "USDC",
    usdt: "USDT",
    eth: "ETH",
    btc: "WBTC",
    sol: "SOL",
    arb: "ARB",
  };
  return symbols[asset];
}

/** Ordered candidate symbols for resolving an asset to a LI.FI token. */
export function assetLookupSymbols(asset: ProductAsset): string[] {
  const primary = productAssetPrimarySymbol(asset).toUpperCase();
  const matches = ASSETS[asset]?.matchSymbols ?? [];
  return [primary, ...matches.filter((symbol) => symbol !== primary)];
}
