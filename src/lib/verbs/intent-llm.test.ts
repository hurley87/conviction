import { describe, it, expect } from "vitest";
import { parseIntentLLM } from "@/lib/verbs/intent-llm";
import { parseIntentHeuristic } from "@/lib/verbs/intent";

// With no AI_GATEWAY_API_KEY in the test env, IS_LLM_PARSING is false, so the
// LLM parser must degrade to the deterministic heuristic — never hitting the
// network. This is the guarantee that keeps CI offline (ADR 0014).
describe("parseIntentLLM (no gateway configured)", () => {
  it("falls back to the heuristic parser for a buy intent", async () => {
    const result = await parseIntentLLM("buy ETH for $25");
    expect(result).toEqual(parseIntentHeuristic("buy ETH for $25"));
    expect(result.kind).toBe("intent");
  });

  it("falls back to the heuristic for a clarify case", async () => {
    const result = await parseIntentLLM("move to cash");
    expect(result.kind).toBe("clarify");
  });
});
