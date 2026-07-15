import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  buildReceiptSummary,
  inferSpentSymbol,
  legsFromUserOps,
  resolveReceiptSourceChain,
} from "@/lib/verbs/receipt";
import { explorerUrl } from "@/lib/verbs/chains";

describe("explorerUrl", () => {
  it("maps chain ids to explorer bases", () => {
    expect(explorerUrl(42161, "0xabc")).toBe(
      "https://arbiscan.io/tx/0xabc",
    );
    expect(explorerUrl(8453, "0xdef")).toBe(
      "https://basescan.org/tx/0xdef",
    );
  });
});

describe("legsFromUserOps", () => {
  it("builds per-chain legs with explorer links", () => {
    const legs = legsFromUserOps([
      { chainId: 8453, userOpHash: "0xsource" },
      { chainId: 42161, userOpHash: "0xdest" },
    ]);
    expect(legs).toHaveLength(2);
    expect(legs[0]?.chain).toBe("Base");
    expect(legs[1]?.chain).toBe("Arbitrum");
    expect(legs[0]?.explorerUrl).toContain("basescan.org");
    expect(legs[1]?.explorerUrl).toContain("arbiscan.io");
  });
});

describe("resolveReceiptSourceChain", () => {
  it("prefers a non-destination leg over a mis-ordered quote source", () => {
    const legs = legsFromUserOps([
      { chainId: 8453, userOpHash: "0xbase" },
      { chainId: 42161, userOpHash: "0xarb" },
    ]);
    expect(
      resolveReceiptSourceChain("Arbitrum", "Arbitrum", legs),
    ).toBe("Base");
  });

  it("keeps the quoted source on same-chain receipts", () => {
    const legs = legsFromUserOps([
      { chainId: 42161, userOpHash: "0xarb" },
    ]);
    expect(
      resolveReceiptSourceChain("Arbitrum", "Arbitrum", legs),
    ).toBe("Arbitrum");
  });
});

describe("inferSpentSymbol", () => {
  it("uses fromAsset when selling", () => {
    expect(
      inferSpentSymbol({
        fromAsset: "eth",
        toAsset: "cash",
        destChain: "Arbitrum",
      }),
    ).toBe("ETH");
  });

  it("defaults to USDC for cash-funded buys", () => {
    expect(
      inferSpentSymbol({ toAsset: "eth", destChain: "Arbitrum" }),
    ).toBe("USDC");
  });
});

describe("buildReceiptSummary", () => {
  it("names spent and received tokens across chains", () => {
    const summary = buildReceiptSummary(
      25,
      24.95,
      "Base",
      "Arbitrum",
      "USDC",
    );
    expect(summary).toBe(
      "$25.00 USDC from Base → $24.95 USDC on Arbitrum",
    );
  });

  it("shows a non-cash destination token", () => {
    const summary = buildReceiptSummary(
      20,
      20.01,
      "Base",
      "Arbitrum",
      "ETH",
      "USDC",
    );
    expect(summary).toBe(
      "$20.00 USDC from Base → $20.01 ETH on Arbitrum",
    );
  });
});

describe("buildReceipt", () => {
  it("assembles a full receipt from quote amounts + per-chain legs", () => {
    const receipt = buildReceipt(
      "abc123",
      {
        dollarsIn: 25,
        dollarsOut: 24.95,
        feeUsd: 0.05,
        sourceChain: "Base",
        destChain: "Arbitrum",
        toAsset: "cash",
        sourceSymbol: "USDC",
      },
      [
        { chainId: 8453, userOpHash: "0xsource" },
        { chainId: 42161, userOpHash: "0xdest" },
      ],
    );
    expect(receipt.slug).toBe("abc123");
    expect(receipt.legs).toHaveLength(2);
    expect(receipt.dollarsIn).toBe(25);
    expect(receipt.dollarsOut).toBe(24.95);
    expect(receipt.feeUsd).toBe(0.05);
    expect(receipt.summary).toBe(
      "$25.00 USDC from Base → $24.95 USDC on Arbitrum",
    );
  });

  it("corrects a mislabeled same-chain summary when legs show a foreign source", () => {
    const receipt = buildReceipt(
      "10d7aa2987f4",
      {
        dollarsIn: 20,
        dollarsOut: 20.01,
        feeUsd: 0.43,
        // Quote wrongly reported Arbitrum as source (SDK debit order).
        sourceChain: "Arbitrum",
        destChain: "Arbitrum",
        toAsset: "eth",
        receivedSymbol: "ETH",
        sourceSymbol: "USDC",
      },
      [
        { chainId: 8453, userOpHash: "0xbase" },
        { chainId: 42161, userOpHash: "0xarb" },
      ],
    );
    expect(receipt.summary).toBe(
      "$20.00 USDC from Base → $20.01 ETH on Arbitrum",
    );
  });

  it("labels with the real on-chain token when the SDK reports it", () => {
    const receipt = buildReceipt(
      "eth1",
      {
        dollarsIn: 0.5,
        dollarsOut: 0.46,
        feeUsd: 0.04,
        sourceChain: "Arbitrum",
        destChain: "Arbitrum",
        toAsset: "eth",
        receivedSymbol: "wstETH",
        sourceSymbol: "USDC",
      },
      [{ chainId: 42161, userOpHash: "0xdest" }],
    );
    // Reflects what actually settled, not the product-level "ETH".
    expect(receipt.summary).toContain("wstETH");
  });
});
