// Single source of product-asset knowledge: the UA token type each product
// maps to, and the balance symbols that count as that product (including
// wrapped variants). Both the intent validator and the trade payload builder
// read from here so adding an asset or alias is a one-line table edit.

import type { ProductAsset } from "@/lib/verbs/types";

type AssetInfo = {
  /** UA SUPPORTED_TOKEN_TYPE string. */
  uaTokenType: string;
  /** Balance symbols (uppercase) that satisfy this product. */
  matchSymbols: string[];
};

const ASSETS: Record<ProductAsset, AssetInfo> = {
  cash: { uaTokenType: "usdc", matchSymbols: ["USDC", "USDT"] },
  usdc: { uaTokenType: "usdc", matchSymbols: ["USDC"] },
  usdt: { uaTokenType: "usdt", matchSymbols: ["USDT"] },
  eth: { uaTokenType: "eth", matchSymbols: ["ETH", "WETH"] },
  btc: { uaTokenType: "btc", matchSymbols: ["BTC", "WBTC"] },
  sol: { uaTokenType: "sol", matchSymbols: ["SOL"] },
};

/** Map product asset to UA SUPPORTED_TOKEN_TYPE string. */
export function toUaTokenType(asset: ProductAsset): string {
  return ASSETS[asset]?.uaTokenType ?? "usdc";
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
  };
  return symbols[asset];
}
