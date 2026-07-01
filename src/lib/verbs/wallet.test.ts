import { describe, it, expect } from "vitest";
import { isDelegated } from "@/lib/verbs/wallet";

describe("isDelegated", () => {
  it("detects a 7702 delegation designator", () => {
    expect(
      isDelegated("0xef010013e00e089f81ad9f36b655c9e9a07c6bf1489a5a"),
    ).toBe(true);
  });

  it("is case-insensitive on the prefix", () => {
    expect(
      isDelegated("0xEF010013E00E089F81AD9F36B655C9E9A07C6BF1489A5A"),
    ).toBe(true);
  });

  it("treats a plain EOA (no code) as not delegated", () => {
    expect(isDelegated("0x")).toBe(false);
  });

  it("treats ordinary contract code as not delegated", () => {
    expect(isDelegated("0x6080604052348015")).toBe(false);
  });

  it("handles null/undefined", () => {
    expect(isDelegated(null)).toBe(false);
    expect(isDelegated(undefined)).toBe(false);
  });
});
