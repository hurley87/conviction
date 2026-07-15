import { describe, it, expect } from "vitest";
import { ROUTING_PENDING_COPY } from "@/components/trade-pending";

describe("ROUTING_PENDING_COPY", () => {
  it("narrates UA routing without chain jargon", () => {
    expect(ROUTING_PENDING_COPY).toMatch(/Universal Account/i);
    expect(ROUTING_PENDING_COPY.toLowerCase()).not.toMatch(
      /arbitrum|base|ethereum|7702|eip|bridge|chain/,
    );
  });
});
