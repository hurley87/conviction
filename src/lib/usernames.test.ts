import { describe, expect, it } from "vitest";
import { normalizeUsername, validateUsername } from "@/lib/usernames";

describe("public username rules", () => {
  it("normalizes case, whitespace, and one leading at-sign", () => {
    expect(normalizeUsername("  @Conviction_7 ")).toBe("conviction_7");
    expect(normalizeUsername("Trader")).toBe(normalizeUsername("trader"));
  });

  it("accepts only 3-20 lowercase letters, numbers, or underscores", () => {
    expect(validateUsername("abc")).toEqual({ ok: true, username: "abc" });
    expect(validateUsername("a" ).ok).toBe(false);
    expect(validateUsername("twenty_characters_ok").ok).toBe(true);
    expect(validateUsername("twenty_one_charactersx").ok).toBe(false);
    expect(validateUsername("not-valid").ok).toBe(false);
    expect(validateUsername("two words").ok).toBe(false);
  });
});
