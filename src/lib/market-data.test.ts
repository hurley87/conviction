import { describe, it, expect, beforeEach } from "vitest";
import {
  getSparkline,
  placeholderSparkline,
  resetMarketDataCacheForTests,
} from "@/lib/market-data";

describe("placeholderSparkline", () => {
  it("returns deterministic series for the same asset", () => {
    expect(placeholderSparkline("eth")).toEqual(placeholderSparkline("eth"));
  });

  it("returns different series for different assets", () => {
    expect(placeholderSparkline("eth")).not.toEqual(placeholderSparkline("btc"));
  });
});

describe("getSparkline", () => {
  beforeEach(() => {
    resetMarketDataCacheForTests();
  });

  it("caches results within TTL", async () => {
    const first = await getSparkline("eth");
    const second = await getSparkline("eth");
    expect(first).toBe(second);
  });
});
