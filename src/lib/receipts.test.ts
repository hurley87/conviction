import { describe, it, expect, beforeEach } from "vitest";
import {
  getReceiptEntryAt,
  getStoredReceipt,
  getStoredReceiptRecord,
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

  it("round-trips a receipt and exposes entryAt in one read", async () => {
    const before = Date.now();
    await saveReceipt(sample);
    const after = Date.now();

    const record = await getStoredReceiptRecord("entry-abc");
    expect(record?.receipt).toEqual(sample);
    expect(record?.entryAt).toBeTruthy();
    const ms = Date.parse(record!.entryAt);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);

    expect(await getStoredReceipt("entry-abc")).toEqual(sample);
    expect(await getReceiptEntryAt("entry-abc")).toBe(record!.entryAt);
  });

  it("returns null for unknown slugs", async () => {
    expect(await getStoredReceipt("missing")).toBeNull();
    expect(await getReceiptEntryAt("missing")).toBeNull();
    expect(await getStoredReceiptRecord("missing")).toBeNull();
  });
});
