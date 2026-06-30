import { describe, it, expect } from "vitest";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import { FloorAbortError } from "@/lib/verbs/types";

describe("MockUAClient trade verbs (ADR 0014)", () => {
  it("quoteTrade sources from a different chain than Arbitrum settlement", async () => {
    const ua = new MockUAClient();
    const quote = await ua.quoteTrade({
      intent: { toAsset: "cash", destChain: "Arbitrum" },
      sizeUsd: 25,
    });

    expect(quote.sourceChain).toBe("Base");
    expect(quote.destChain).toBe("Arbitrum");
    expect(quote.sourceChain).not.toBe(quote.destChain);
    expect(ua.tradeRecords[0]?.sourceChain).toBe("Base");
  });

  it("executeTrade completes and returns receipt legs on both chains", async () => {
    const ua = new MockUAClient();
    const quote = await ua.quoteTrade({
      intent: { toAsset: "cash", destChain: "Arbitrum" },
      sizeUsd: 25,
    });

    const result = await ua.executeTrade({
      intent: { toAsset: "cash", destChain: "Arbitrum" },
      sizeUsd: 25,
      agreedQuote: quote,
      signers: mockTradeSigners,
      receiptSlug: "testslug",
    });

    expect(result.receipt.legs.length).toBeGreaterThanOrEqual(2);
    expect(result.receipt.summary).toContain("Base");
    expect(result.receipt.summary).toContain("Arbitrum");
    expect(result.summary.toLowerCase()).toContain("done");
  });

  it("executeTrade aborts and re-quotes when fill is below the floor", async () => {
    const ua = new MockUAClient({ simulateStaleQuote: true });
    const quote = await ua.quoteTrade({
      intent: { toAsset: "cash", destChain: "Arbitrum" },
      sizeUsd: 25,
    });

    await expect(
      ua.executeTrade({
        intent: { toAsset: "cash", destChain: "Arbitrum" },
        sizeUsd: 25,
        agreedQuote: quote,
        signers: mockTradeSigners,
        receiptSlug: "stale",
      }),
    ).rejects.toBeInstanceOf(FloorAbortError);
  });

  it("FloorAbortError carries the fresh quote for re-confirm", async () => {
    const ua = new MockUAClient({ simulateStaleQuote: true });
    const quote = await ua.quoteTrade({
      intent: { toAsset: "cash", destChain: "Arbitrum" },
      sizeUsd: 25,
    });

    try {
      await ua.executeTrade({
        intent: { toAsset: "cash", destChain: "Arbitrum" },
        sizeUsd: 25,
        agreedQuote: quote,
        signers: mockTradeSigners,
        receiptSlug: "stale2",
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FloorAbortError);
      if (e instanceof FloorAbortError) {
        expect(e.freshQuote.dollarsOut).toBeLessThan(quote.floorUsd);
      }
    }
  });
});
