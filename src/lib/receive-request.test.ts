import { describe, expect, it } from "vitest";
import {
  buildReceiveRequest,
  normalizeReceiveAmount,
} from "@/lib/receive-request";

describe("receive request", () => {
  it("formats an amount-specific Base request", () => {
    expect(
      buildReceiveRequest({
        amountRaw: "25.50",
        network: "Base",
        address: "0x1234",
      }),
    ).toEqual({
      ok: true,
      text: "Send me 25.50 USDC on Base to 0x1234.",
    });
  });

  it("formats an amount-free Solana request", () => {
    expect(
      buildReceiveRequest({
        amountRaw: "",
        network: "Solana",
        address: "So1ana",
      }),
    ).toEqual({
      ok: true,
      text: "Send me USDC on Solana to So1ana.",
    });
  });

  it("rejects invalid or over-precise amounts", () => {
    expect(normalizeReceiveAmount("0")).toBeNull();
    expect(normalizeReceiveAmount("-1")).toBeNull();
    expect(normalizeReceiveAmount("1.1234567")).toBeNull();
  });
});
