import { describe, expect, it } from "vitest";
import { identityFromPrivyUser } from "@/lib/privy-profile-auth";
import type { User } from "@privy-io/node";

function user(linked_accounts: User["linked_accounts"]): User {
  return {
    id: "did:privy:user-1",
    created_at: 1,
    has_accepted_terms: true,
    is_guest: false,
    linked_accounts,
    mfa_methods: [],
  };
}

describe("verified Privy identity mapping", () => {
  it("prefers and preserves the provider X handle", () => {
    const identity = identityFromPrivyUser(
      user([
        {
          type: "email",
          address: "person@example.com",
          verified_at: 1,
          first_verified_at: 1,
          latest_verified_at: 1,
        },
        {
          type: "twitter_oauth",
          username: "ProviderHandle",
          name: "Person",
          profile_picture_url: null,
          subject: "x-1",
          verified_at: 1,
          first_verified_at: 1,
          latest_verified_at: 1,
        },
      ]),
    );
    expect(identity).toMatchObject({
      privyId: "did:privy:user-1",
      identitySource: "twitter",
      providerHandle: "ProviderHandle",
      email: "person@example.com",
    });
  });

  it("uses email identity when no X account is linked", () => {
    expect(
      identityFromPrivyUser(
        user([
          {
            type: "email",
            address: "person@example.com",
            verified_at: 1,
            first_verified_at: 1,
            latest_verified_at: 1,
          },
        ]),
      ),
    ).toMatchObject({ identitySource: "email", providerHandle: null });
  });
});
