import { describe, expect, it } from "vitest";
import { z } from "zod";

import { structuredErrorResultSchema } from "../src/agent-reads-contract.js";
import { mcpReadToolOutputSchema } from "../src/mcp-output-schema.js";

describe("mcpReadToolOutputSchema", () => {
  const successSchema = z.object({
    ok: z.literal(true),
    name: z.string(),
  });

  it("keeps Zod success validation strict", () => {
    const outputSchema = mcpReadToolOutputSchema(successSchema);

    expect(outputSchema.safeParse({ ok: true, name: "scout" }).success).toBe(
      true,
    );
    expect(outputSchema.safeParse({ ok: true }).success).toBe(false);
    expect(
      outputSchema.safeParse({
        ok: false,
        code: "not_found",
        message: "missing",
      }).success,
    ).toBe(false);
  });

  it("advertises oneOf success|structured error for MCP hosts", () => {
    const outputSchema = mcpReadToolOutputSchema(successSchema);
    const jsonSchema = z.toJSONSchema(outputSchema) as {
      type?: string;
      oneOf?: unknown[];
    };

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.oneOf).toHaveLength(2);

    expect(
      structuredErrorResultSchema.safeParse({
        ok: false,
        code: "lease_lost",
        message: "gone",
      }).success,
    ).toBe(true);
  });
});
