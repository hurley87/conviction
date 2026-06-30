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
  it("produces a plain net summary", () => {
    const summary = buildReceiptSummary(25, 24.95, "Base", "Arbitrum");
    expect(summary).toContain("Base");
    expect(summary).toContain("Arbitrum");
    expect(summary).toContain("$25.00");
    expect(summary).toContain("$24.95");
  });
});

describe("buildReceipt", () => {
  it("assembles a full receipt from a completed tx", () => {
    const receipt = buildReceipt("abc123", {
      userOps: [
        { chainId: 8453, userOpHash: "0xsource" },
        { chainId: 42161, userOpHash: "0xdest" },
      ],
      tokenChanges: {
        totalDecrAmountInUSD: "25.00",
        totalIncrAmountInUSD: "24.95",
        totalFeeInUSD: "0.05",
        decr: [{ token: { chainId: 8453 } }],
        incr: [{ token: { chainId: 42161 } }],
      },
    });
    expect(receipt.slug).toBe("abc123");
    expect(receipt.legs).toHaveLength(2);
    expect(receipt.dollarsIn).toBe(25);
    expect(receipt.dollarsOut).toBe(24.95);
  });
});
