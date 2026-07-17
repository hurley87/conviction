import { describe, expect, it } from "vitest";
import { mergeUserColumns } from "@/lib/user-identity";

describe("mergeUserColumns", () => {
  it("lets twitter provider handle win and preserves email when absent", () => {
    expect(
      mergeUserColumns(
        {
          handle: "old_name",
          email: "kept@example.com",
          identitySource: "email",
        },
        {
          address: "0xabc",
          email: null,
          identitySource: "twitter",
          providerHandle: "@Provider",
        },
      ),
    ).toEqual({
      handle: "provider",
      address: "0xabc",
      email: "kept@example.com",
      identitySource: "twitter",
    });
  });

  it("keeps email-chosen handles when the same email identity returns", () => {
    expect(
      mergeUserColumns(
        {
          handle: "public_name",
          email: "person@example.com",
          identitySource: "email",
        },
        {
          address: "0xdef",
          email: "person@example.com",
          identitySource: "email",
          providerHandle: null,
        },
      ),
    ).toEqual({
      handle: "public_name",
      address: "0xdef",
      email: "person@example.com",
      identitySource: "email",
    });
  });
});
