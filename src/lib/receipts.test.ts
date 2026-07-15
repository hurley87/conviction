import { describe, it, expect, beforeEach } from "vitest";
import {
  getReceiptEntryAt,
  getStoredReceipt,
  resetReceiptsMemoryForTests,
  saveReceipt,
} from "@/lib/receipts";
import type { Receipt } from "@/lib/verbs/types";

const sample: Receipt = {
  slug: "entry-abc",
  legs: [
    {
      chain: "Base",
      txHash: "0xabc",
      explorerUrl: "https://basescan.org/tx/0xabc",
    },
  ],
  summary: "$8 USDC from Base → $7.90 SURPLUS on Base",
  dollarsIn: 8,
  dollarsOut: 7.9,
  feeUsd: 0.1,
};

describe("receipts memory store", () => {
  beforeEach(() => {
    resetReceiptsMemoryForTests();
  });

  it("round-trips a receipt and exposes entryAt", async () => {
    const before = Date.now();
    await saveReceipt(sample);
    const after = Date.now();

    expect(await getStoredReceipt("entry-abc")).toEqual(sample);

    const entryAt = await getReceiptEntryAt("entry-abc");
    expect(entryAt).toBeTruthy();
    const ms = Date.parse(entryAt!);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("returns null for unknown slugs", async () => {
    expect(await getStoredReceipt("missing")).toBeNull();
    expect(await getReceiptEntryAt("missing")).toBeNull();
  });
});
