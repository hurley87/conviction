import { describe, it, expect } from "vitest";
import { MockUAClient, mockTradeSigners } from "@/lib/ua/mock";
import { WithdrawalStaleQuoteError } from "@/lib/verbs/types";
import type { WithdrawalRequest } from "@/lib/verbs/types";

const REQUEST: WithdrawalRequest = {
  asset: "usdc",
  destChain: "Base",
  amount: "25",
  destination: "0x2222222222222222222222222222222222222222",
};

describe("MockUAClient withdrawals", () => {
  it("quotes and executes a transfer with root-hash signing", async () => {
    const ua = new MockUAClient();
    const quote = await ua.quoteWithdrawal({ request: REQUEST });
    expect(quote.amount).toBe("25");
    expect(quote.estimatedDebitUsd).toBeGreaterThan(0);
    expect(ua.withdrawalRecords).toHaveLength(1);

    const result = await ua.executeWithdrawal({
      request: REQUEST,
      agreedQuote: quote,
      signers: mockTradeSigners,
    });
    expect(result.transactionId).toMatch(/^mock-withdraw-exec-/);
    expect(result.destination).toBe(REQUEST.destination);
    expect(result.signed7702Auth).toBe(true);
  });

  it("aborts when debit moves above the agreed ceiling", async () => {
    const ua = new MockUAClient({ simulateStaleWithdrawal: true });
    const quote = await ua.quoteWithdrawal({ request: REQUEST });
    await expect(
      ua.executeWithdrawal({
        request: REQUEST,
        agreedQuote: quote,
        signers: mockTradeSigners,
      }),
    ).rejects.toBeInstanceOf(WithdrawalStaleQuoteError);
  });

  it("fails when the transaction is missing a root hash", async () => {
    const ua = new MockUAClient({ omitWithdrawalRootHash: true });
    const quote = await ua.quoteWithdrawal({ request: REQUEST });
    await expect(
      ua.executeWithdrawal({
        request: REQUEST,
        agreedQuote: quote,
        signers: mockTradeSigners,
      }),
    ).rejects.toThrow("Transaction missing root hash");
  });

  it("rejects unsupported USDT on Base at quote time", async () => {
    const ua = new MockUAClient();
    await expect(
      ua.quoteWithdrawal({
        request: {
          asset: "usdt",
          destChain: "Base",
          amount: "10",
          destination: REQUEST.destination,
        },
      }),
    ).rejects.toThrow(/Unsupported withdrawal/);
  });

  it("quotes ETH on Arbitrum with a deterministic debit", async () => {
    const ua = new MockUAClient();
    const quote = await ua.quoteWithdrawal({
      request: {
        asset: "eth",
        destChain: "Arbitrum",
        amount: "0.01",
        destination: REQUEST.destination,
      },
    });
    // 0.01 ETH * $2500 + fee
    expect(quote.estimatedDebitUsd).toBeGreaterThan(25);
  });
});
