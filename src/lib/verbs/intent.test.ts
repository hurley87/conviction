import { describe, it, expect } from "vitest";
import {
  parseIntentHeuristic as parseIntent,
  validateIntent,
  resolveSizeUsd,
  pickSettlementChain,
  parseExplicitDestChain,
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
  it("parses a dollar amount to cash without inventing a settlement chain", () => {
    const result = parseIntent("Move $25 to cash");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.sizeUsd).toBe(25);
    expect(result.intent.toAsset).toBe("cash");
    expect(result.intent.destChain).toBeUndefined();
  });

  it("parses 'buy ARB for $5' as an ARB buy (hero card phrasing)", () => {
    const result = parseIntent("buy ARB for $5");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("arb");
    expect(result.intent.sizeUsd).toBe(5);
  });

  it("does not read the chain word 'Arbitrum' as the ARB token", () => {
    const result = parseIntent("Move $25 to cash on Arbitrum");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("cash");
    expect(result.intent.destChain).toBe("Arbitrum");
  });

  it("parses explicit ETH settlement on Arbitrum (money-shot phrasing)", () => {
    const result = parseIntent("buy $20 of ETH on Arbitrum");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("eth");
    expect(result.intent.sizeUsd).toBe(20);
    expect(result.intent.destChain).toBe("Arbitrum");
  });

  it("treats 'on ARB' as Arbitrum settlement, not the ARB token", () => {
    const result = parseIntent('buy $20 of ETH on ARB');
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("eth");
    expect(result.intent.destChain).toBe("Arbitrum");
  });

  it("parses explicit settlement on Base", () => {
    const result = parseIntent("buy $10 of ETH on Base");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("eth");
    expect(result.intent.destChain).toBe("Base");
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

  it("routes 'buy ETH' to a crypto destination, not cash", () => {
    const result = parseIntent("buy ETH for $25");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("eth");
    expect(result.intent.sizeUsd).toBe(25);
  });

  it("parses 'buy <qty> of <asset>' once an amount is supplied", () => {
    // Mirrors the screenshot flow: "lets buy 0.5 of ETH" then "half".
    const clarify = parseIntent("lets buy 0.5 of ETH");
    expect(clarify.kind).toBe("clarify");

    const combined = parseIntent("lets buy 0.5 of ETH half");
    expect(combined.kind).toBe("intent");
    if (combined.kind !== "intent") return;
    expect(combined.intent.toAsset).toBe("eth");
    expect(combined.intent.fraction).toBe(0.5);
  });

  it("routes 'spend half on ETH' to a crypto destination", () => {
    const result = parseIntent("spend half on ETH");
    expect(result.kind).toBe("intent");
    if (result.kind !== "intent") return;
    expect(result.intent.toAsset).toBe("eth");
    expect(result.intent.fraction).toBe(0.5);
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

  it("accepts 'sell all my ETH' — fraction sizes to the ETH slice, not the total", () => {
    const result = validateIntent(
      { toAsset: "cash", fromAsset: "eth", fraction: 1, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sizeUsd).toBeCloseTo(62.5);
  });

  it("rejects a no-op when funds are already cash on the settlement chain", () => {
    const allCash: UniversalBalance = {
      totalUsd: 1,
      sources: [{ chain: "Arbitrum", asset: "USDC", usd: 1 }],
    };
    const result = validateIntent({ ...intent, sizeUsd: 0.5 }, allCash);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("already in cash");
  });

  it("allows buying ETH (wired on the settlement chain)", () => {
    const result = validateIntent(
      { toAsset: "eth", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(true);
  });

  it("allows buying BTC on Base (its only routable settlement chain)", () => {
    const result = validateIntent(
      { toAsset: "btc", sizeUsd: 25, destChain: "Base" },
      balance,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects buying BTC on Arbitrum — no warm-up router coverage there", () => {
    const result = validateIntent(
      { toAsset: "btc", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(false);
  });

  it("ARB passes static validation (fails at quote time with no-route — the gate-kill candidate)", () => {
    const result = validateIntent(
      { toAsset: "arb", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects selling ARB — buy-only, not a UA primary token", () => {
    const result = validateIntent(
      { fromAsset: "arb", toAsset: "cash", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("only be bought");
  });

  it("rejects converting another asset into ARB — buy with cash instead", () => {
    const result = validateIntent(
      { fromAsset: "eth", toAsset: "arb", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("with cash instead");
  });

  it("rejects a concrete token buy funded by an unsupported source", () => {
    const result = validateIntent(
      {
        fromAsset: "btc",
        toAsset: "token",
        token: {
          chainId: 8453,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
        sizeUsd: 5,
        destChain: "Base",
      },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("can't fund");
  });

  it("rejects a concrete token buy when the selected primary source is empty", () => {
    const result = validateIntent(
      {
        fromAsset: "sol",
        toAsset: "token",
        token: {
          chainId: 8453,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
        sizeUsd: 5,
        destChain: "Base",
      },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("don't hold");
  });

  it("rejects a concrete token amount above the selected source balance", () => {
    const result = validateIntent(
      {
        fromAsset: "eth",
        toAsset: "token",
        token: {
          chainId: 8453,
          address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
          symbol: "SURPLUS",
        },
        sizeUsd: 100,
        destChain: "Base",
      },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("$62.50");
  });

  it("rejects buying SOL — no address on the EVM settlement chain", () => {
    const result = validateIntent(
      { toAsset: "sol", sizeUsd: 25, destChain: "Arbitrum" },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("isn't supported");
  });

  const SURPLUS = {
    chainId: 8453,
    address: "0xC52aeDec3374422d7510E294cfAa90799595CBa3",
    symbol: "SURPLUS",
  };

  it("allows a concrete-token buy (deck card) with no product-table entry", () => {
    const result = validateIntent(
      { toAsset: "token", token: SURPLUS, sizeUsd: 5, destChain: "Base" },
      balance,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a concrete token on a chain we can't settle on", () => {
    const pepeOnEthereum = { chainId: 1, address: "0x6982…", symbol: "PEPE" };
    const result = validateIntent(
      { toAsset: "token", token: pepeOnEthereum, sizeUsd: 5, destChain: "Base" },
      balance,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("can't settle on yet");
  });

  it("allows buying a concrete token with a selected primary asset", () => {
    const result = validateIntent(
      {
        fromAsset: "eth",
        toAsset: "token",
        token: SURPLUS,
        sizeUsd: 5,
        destChain: "Base",
      },
      balance,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects the token sentinel without a TokenRef attached", () => {
    const result = validateIntent(
      { toAsset: "token", sizeUsd: 5, destChain: "Base" },
      balance,
    );
    expect(result.ok).toBe(false);
  });

  it("allows cashing out USDC that lives on another chain", () => {
    const usdcOnBase: UniversalBalance = {
      totalUsd: 1,
      sources: [{ chain: "Base", asset: "USDC", usd: 1 }],
    };
    const result = validateIntent({ ...intent, sizeUsd: 0.5 }, usdcOnBase);
    expect(result.ok).toBe(true);
  });
});

describe("pickSettlementChain", () => {
  it("keeps cash on Arbitrum regardless of where funds sit (ADR 0005)", () => {
    const baseHeavy: UniversalBalance = {
      totalUsd: 100,
      sources: [{ chain: "Base", asset: "USDC", usd: 100 }],
    };
    expect(pickSettlementChain("cash", baseHeavy)).toBe("Arbitrum");
  });

  it("buys on Base when that's where the funds are (no bridge)", () => {
    const baseHeavy: UniversalBalance = {
      totalUsd: 100,
      sources: [
        { chain: "Base", asset: "USDC", usd: 90 },
        { chain: "Arbitrum", asset: "USDC", usd: 10 },
      ],
    };
    expect(pickSettlementChain("eth", baseHeavy)).toBe("Base");
  });

  it("buys on Arbitrum when funds are mostly there", () => {
    // The shared fixture holds more on Arbitrum (180) than Base (62.5).
    expect(pickSettlementChain("eth", balance)).toBe("Arbitrum");
  });

  it("defaults to Arbitrum when nothing is funded", () => {
    const empty: UniversalBalance = { totalUsd: 0, sources: [] };
    expect(pickSettlementChain("eth", empty)).toBe("Arbitrum");
  });

  it("BTC settles on Base — its only wired chain", () => {
    expect(pickSettlementChain("btc", balance)).toBe("Base");
  });

  it("an ARB buy would settle on Arbitrum, its only wired chain", () => {
    const baseHeavy: UniversalBalance = {
      totalUsd: 100,
      sources: [
        { chain: "Base", asset: "USDC", usd: 90 },
        { chain: "Arbitrum", asset: "USDC", usd: 10 },
      ],
    };
    expect(pickSettlementChain("arb", baseHeavy)).toBe("Arbitrum");
  });
});

describe("parseExplicitDestChain", () => {
  it("reads on/settle-on chain phrases", () => {
    expect(parseExplicitDestChain("buy $20 of ETH on Arbitrum")).toBe(
      "Arbitrum",
    );
    expect(parseExplicitDestChain("buy $20 of ETH on ARB")).toBe("Arbitrum");
    expect(parseExplicitDestChain("settle on Base")).toBe("Base");
    expect(parseExplicitDestChain("buy $20 of ETH")).toBeUndefined();
  });
});

describe("resolveSizeUsd", () => {
  it("uses sizeUsd when set", () => {
    expect(
      resolveSizeUsd({ toAsset: "cash", sizeUsd: 25, destChain: "Arbitrum" }, balance),
    ).toBe(25);
  });

  it("computes a bare fraction from the whole balance", () => {
    expect(
      resolveSizeUsd(
        { toAsset: "cash", fraction: 0.5, destChain: "Arbitrum" },
        balance,
      ),
    ).toBeCloseTo(121.25);
  });

  it("applies a fraction to the source asset when one is named", () => {
    // Fixture holds $62.50 of ETH — "half my ETH" is $31.25, not half of $242.50.
    expect(
      resolveSizeUsd(
        { toAsset: "cash", fromAsset: "eth", fraction: 0.5, destChain: "Arbitrum" },
        balance,
      ),
    ).toBeCloseTo(31.25);
  });

  it("sizes 'all my ETH' to the full ETH slice", () => {
    expect(
      resolveSizeUsd(
        { toAsset: "cash", fromAsset: "eth", fraction: 1, destChain: "Arbitrum" },
        balance,
      ),
    ).toBeCloseTo(62.5);
  });
});
