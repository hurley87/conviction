import { describe, it, expect } from "vitest";
import {
  parseIntent,
  validateIntent,
  resolveSizeUsd,
} from "@/lib/verbs/intent";
import type { TradeIntent, UniversalBalance } from "@/lib/verbs/types";

const balance: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

describe("parseIntent", () => {
  it("parses a dollar amount to cash on Arbitrum", () => {
    const result = parseIntent("Move $25 to cash");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.sizeUsd).toBe(25);
    expect(result.intent.toAsset).toBe("cash");
    expect(result.intent.destChain).toBe("Arbitrum");
  });

  it("parses explicit 'all' fraction", () => {
    const result = parseIntent("Move all to cash");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.fraction).toBe(1);
  });

  it("parses half and percentage fractions", () => {
    const half = parseIntent("Convert half to cash");
    expect(half.kind).toBe("intent");
    if (half.kind === "intent") expect(half.intent.fraction).toBe(0.5);

    const pct = parseIntent("Move 25% to cash");
    expect(pct.kind).toBe("intent");
    if (pct.kind === "intent") expect(pct.intent.fraction).toBe(0.25);
  });

  it("never silently infers 'all' when amount is missing", () => {
    const result = parseIntent("Move to cash");
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") {
      expect(result.question.toLowerCase()).toContain("how much");
    }
  });

  it("asks to clarify on empty input", () => {
    expect(parseIntent("").kind).toBe("clarify");
    expect(parseIntent("   ").kind).toBe("clarify");
  });

  it("extracts from-asset hints", () => {
    const result = parseIntent("Sell my ETH for $10 cash");
    expect(result.kind).toBe("intent");
    if (result.kind === "intent") {
      expect(result.intent.fromAsset).toBe("eth");
      expect(result.intent.sizeUsd).toBe(10);
    }
  });
});

describe("validateIntent", () => {
  const intent: TradeIntent = {
    toAsset: "cash",
    sizeUsd: 25,
    destChain: "Arbitrum",
  };

  it("accepts a valid intent within balance", () => {
    const result = validateIntent(intent, balance);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sizeUsd).toBe(25);
  });

  it("rejects amounts exceeding unified balance", () => {
    const result = validateIntent(
      { ...intent, sizeUsd: 500 },
      balance,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects from-asset when user holds none", () => {
    const result = validateIntent(
      { ...intent, fromAsset: "btc", sizeUsd: 10 },
      balance,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects from-asset amount exceeding that asset slice", () => {
    const result = validateIntent(
      { ...intent, fromAsset: "eth", sizeUsd: 100 },
      balance,
    );
    expect(result.ok).toBe(false);
  });
});

describe("resolveSizeUsd", () => {
  it("uses sizeUsd when set", () => {
    expect(
      resolveSizeUsd({ toAsset: "cash", sizeUsd: 25, destChain: "Arbitrum" }, balance),
    ).toBe(25);
  });

  it("computes from fraction", () => {
    expect(
      resolveSizeUsd(
        { toAsset: "cash", fraction: 0.5, destChain: "Arbitrum" },
        balance,
      ),
    ).toBeCloseTo(121.25);
  });
});
