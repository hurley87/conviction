import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  buildReceiptSummary,
  legsFromUserOps,
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

describe("buildReceiptSummary", () => {
  it("produces a plain net summary with the destination token", () => {
    const summary = buildReceiptSummary(25, 24.95, "Base", "Arbitrum", "USDC");
    expect(summary).toContain("Base");
    expect(summary).toContain("Arbitrum");
    expect(summary).toContain("$25.00");
    expect(summary).toContain("$24.95");
    expect(summary).toContain("USDC");
  });

  it("shows a non-cash destination token", () => {
    const summary = buildReceiptSummary(0.5, 0.46, "Arbitrum", "Arbitrum", "ETH");
    expect(summary).toContain("ETH");
    expect(summary).not.toContain("USDC");
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
    expect(receipt.summary).toContain("Base");
    expect(receipt.summary).toContain("Arbitrum");
    expect(receipt.summary).toContain("USDC");
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
      },
      [{ chainId: 42161, userOpHash: "0xdest" }],
    );
    // Reflects what actually settled, not the product-level "ETH".
    expect(receipt.summary).toContain("wstETH");
  });
});
