// Server-cached sparkline data for feed charts (issue #4).
// Pluggable source — ships deterministic placeholder series until
// CoinGecko/Birdeye OHLC is wired.

import "server-only";
import type { ProductAsset } from "@/lib/verbs/types";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { series: number[]; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/** Deterministic pseudo-random sparkline from an asset label. */
export function placeholderSparkline(asset: string, points = 24): number[] {
  let seed = 0;
  for (let i = 0; i < asset.length; i++) {
    seed = (seed * 31 + asset.charCodeAt(i)) >>> 0;
  }

  const series: number[] = [];
  let value = 100 + (seed % 50);
  for (let i = 0; i < points; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const delta = ((seed % 200) - 100) / 100;
    value = Math.max(1, value + delta);
    series.push(Math.round(value * 100) / 100);
  }
  return series;
}

export async function getSparkline(asset: ProductAsset | string): Promise<number[]> {
  const key = String(asset).toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.series;
  }

  const series = placeholderSparkline(key);
  cache.set(key, { series, expiresAt: now + CACHE_TTL_MS });
  return series;
}

/** Test helper — clear the in-memory cache. */
export function resetMarketDataCacheForTests() {
  cache.clear();
}
