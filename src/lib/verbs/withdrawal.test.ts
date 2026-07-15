import { describe, it, expect } from "vitest";
import {
  availableUsdForAsset,
  computeMaxDebit,
  isAboveMaxDebit,
  isSupportedWithdrawalPair,
  narrateWithdrawal,
  parseTokenAmount,
  requestFromQuote,
  sendActivityId,
  shapeWithdrawalQuote,
  supportedWithdrawalChains,
  validateWithdrawal,
  withdrawalTokenRef,
  WITHDRAWAL_DEBIT_TOLERANCE,
} from "@/lib/verbs/withdrawal";
import type { UniversalBalance } from "@/lib/verbs/types";

const OWNER = "0x1111111111111111111111111111111111111111";
const EXTERNAL = "0x2222222222222222222222222222222222222222";

const balance: UniversalBalance = {
  totalUsd: 242.5,
  sources: [
    { chain: "Arbitrum", asset: "USDC", usd: 180 },
    { chain: "Base", asset: "ETH", usd: 62.5 },
  ],
};

describe("supportedWithdrawalPairs", () => {
  it("allows ETH and USDC on Base and Arbitrum", () => {
    expect(supportedWithdrawalChains("usdc")).toEqual(["Arbitrum", "Base"]);
    expect(supportedWithdrawalChains("eth")).toEqual(["Arbitrum", "Base"]);
    expect(isSupportedWithdrawalPair("usdc", "Base")).toBe(true);
    expect(isSupportedWithdrawalPair("eth", "Arbitrum")).toBe(true);
  });

  it("restricts USDT to Arbitrum", () => {
    expect(supportedWithdrawalChains("usdt")).toEqual(["Arbitrum"]);
    expect(isSupportedWithdrawalPair("usdt", "Arbitrum")).toBe(true);
    expect(isSupportedWithdrawalPair("usdt", "Base")).toBe(false);
    expect(withdrawalTokenRef("usdt", "Base")).toBeNull();
    expect(withdrawalTokenRef("usdt", "Arbitrum")?.address).toMatch(/^0x/i);
  });
});

describe("parseTokenAmount", () => {
  it("accepts positive finite amounts within decimal limits", () => {
    expect(parseTokenAmount("25.5", "usdc")).toEqual({
      ok: true,
      amount: "25.5",
    });
    expect(parseTokenAmount("0.01", "eth")).toEqual({
      ok: true,
      amount: "0.01",
    });
  });

  it("rejects empty, non-numeric, zero, negative, and excess precision", () => {
    expect(parseTokenAmount("", "usdc").ok).toBe(false);
    expect(parseTokenAmount("abc", "usdc").ok).toBe(false);
    expect(parseTokenAmount("0", "usdc").ok).toBe(false);
    expect(parseTokenAmount("-1", "usdc").ok).toBe(false);
    expect(parseTokenAmount("1.1234567", "usdc").ok).toBe(false);
    expect(parseTokenAmount("1.1234567890123456789", "eth").ok).toBe(false);
  });
});

describe("validateWithdrawal", () => {
  it("accepts a valid USDC → Base send", () => {
    const result = validateWithdrawal({
      asset: "usdc",
      destChain: "Base",
      amountRaw: "25",
      destinationRaw: EXTERNAL,
      ownerAddress: OWNER,
      balance,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.destination).toBe(EXTERNAL);
      expect(result.request.amount).toBe("25");
    }
  });

  it("rejects malformed, zero, and self destinations", () => {
    expect(
      validateWithdrawal({
        asset: "usdc",
        destChain: "Arbitrum",
        amountRaw: "10",
        destinationRaw: "not-an-address",
        ownerAddress: OWNER,
        balance,
      }).ok,
    ).toBe(false);

    expect(
      validateWithdrawal({
        asset: "usdc",
        destChain: "Arbitrum",
        amountRaw: "10",
        destinationRaw: "0x0000000000000000000000000000000000000000",
        ownerAddress: OWNER,
        balance,
      }).ok,
    ).toBe(false);

    expect(
      validateWithdrawal({
        asset: "usdc",
        destChain: "Arbitrum",
        amountRaw: "10",
        destinationRaw: OWNER,
        ownerAddress: OWNER,
        balance,
      }).ok,
    ).toBe(false);
  });

  it("rejects USDT on Base and insufficient USDC", () => {
    const usdtBase = validateWithdrawal({
      asset: "usdt",
      destChain: "Base",
      amountRaw: "10",
      destinationRaw: EXTERNAL,
      ownerAddress: OWNER,
      balance,
    });
    expect(usdtBase.ok).toBe(false);

    const overdraft = validateWithdrawal({
      asset: "usdc",
      destChain: "Arbitrum",
      amountRaw: "999",
      destinationRaw: EXTERNAL,
      ownerAddress: OWNER,
      balance,
    });
    expect(overdraft.ok).toBe(false);
  });

  it("rejects ETH when none is available", () => {
    const noEth: UniversalBalance = {
      totalUsd: 50,
      sources: [{ chain: "Arbitrum", asset: "USDC", usd: 50 }],
    };
    const result = validateWithdrawal({
      asset: "eth",
      destChain: "Arbitrum",
      amountRaw: "0.01",
      destinationRaw: EXTERNAL,
      ownerAddress: OWNER,
      balance: noEth,
    });
    expect(result.ok).toBe(false);
  });
});

describe("availableUsdForAsset", () => {
  it("sums matching symbols across chains", () => {
    expect(availableUsdForAsset(balance, "usdc")).toBe(180);
    expect(availableUsdForAsset(balance, "eth")).toBe(62.5);
    expect(availableUsdForAsset(balance, "usdt")).toBe(0);
  });
});

describe("debit ceiling", () => {
  it("applies 1% max debit increase", () => {
    expect(WITHDRAWAL_DEBIT_TOLERANCE).toBe(0.01);
    expect(computeMaxDebit(100)).toBeCloseTo(101);
    expect(isAboveMaxDebit(101.1, 101)).toBe(true);
    expect(isAboveMaxDebit(100.5, 101)).toBe(false);
  });
});

describe("shapeWithdrawalQuote", () => {
  it("maps tokenChanges into a jargon-light quote", () => {
    const quote = shapeWithdrawalQuote(
      {
        totalDecrAmountInUSD: "25.12",
        totalFeeInUSD: "0.12",
      },
      {
        asset: "usdc",
        destChain: "Base",
        amount: "25",
        destination: EXTERNAL,
      },
      "tx-w-1",
      {},
    );
    expect(quote.estimatedDebitUsd).toBe(25.12);
    expect(quote.feeUsd).toBe(0.12);
    expect(quote.maxDebitUsd).toBeCloseTo(25.12 * 1.01);
    expect(quote.destination).toBe(EXTERNAL);
    expect(quote.destChain).toBe("Base");
  });
});

describe("narrateWithdrawal", () => {
  it("summarizes amount and truncated destination", () => {
    const summary = narrateWithdrawal({
      asset: "usdc",
      destChain: "Arbitrum",
      amount: "10",
      destination: EXTERNAL,
    });
    expect(summary).toContain("10 USDC");
    expect(summary).toContain("0x2222");
  });
});

describe("requestFromQuote / sendActivityId", () => {
  it("derives the request from quote fields only", () => {
    const quote = shapeWithdrawalQuote(
      { totalDecrAmountInUSD: "10", totalFeeInUSD: "0.05" },
      {
        asset: "usdc",
        destChain: "Base",
        amount: "10",
        destination: EXTERNAL,
      },
      "tx-1",
      {},
    );
    expect(requestFromQuote(quote)).toEqual({
      asset: "usdc",
      destChain: "Base",
      amount: "10",
      destination: EXTERNAL,
    });
  });

  it("namespaces send activity ids", () => {
    expect(sendActivityId("abc")).toBe("send:abc");
  });
});
