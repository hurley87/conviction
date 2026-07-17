import { describe, expect, it } from "vitest";
import { parseAgentJsonObject } from "@/lib/agent-api-body";

describe("parseAgentJsonObject", () => {
  it("returns an empty object for blank bodies", () => {
    expect(parseAgentJsonObject("")).toEqual({});
    expect(parseAgentJsonObject("   ")).toEqual({});
  });

  it("parses object bodies", () => {
    expect(parseAgentJsonObject('{"replace":true}')).toEqual({ replace: true });
  });

  it("rejects invalid JSON and non-objects with invalid_request", () => {
    expect(() => parseAgentJsonObject("{")).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => parseAgentJsonObject("[]")).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(() => parseAgentJsonObject('"x"')).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });
});
