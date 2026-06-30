import { describe, expect, it } from "vitest";
import { FUNDING_TARGET } from "@/lib/funding";
import { MockUAClient } from "@/lib/ua/mock";

describe("FUNDING_TARGET", () => {
  it("targets USDC on Base for UA unification (ADR 0015)", () => {
    expect(FUNDING_TARGET).toEqual({ chainId: 8453, asset: "USDC" });
  });
});

describe("mock deposit addresses", () => {
  it("returns EVM address and null Solana by default (ADR 0014)", async () => {
    const ua = new MockUAClient();
    const deposits = await ua.getDepositAddresses();
    expect(deposits.evm).toMatch(/^0x/);
    expect(deposits.solana).toBeNull();
  });
});
