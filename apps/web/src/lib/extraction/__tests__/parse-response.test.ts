import { describe, it, expect } from "vitest";
import { parseAIResponse } from "../parse-response";

describe("parseAIResponse", () => {
  it("parses clean JSON", () => {
    const result = parseAIResponse('{"accounts": []}');
    expect(result).toEqual({ accounts: [] });
  });

  it("strips markdown code fences", () => {
    const input = '```json\n{"accounts": [{"name": "IRA"}]}\n```';
    const result = parseAIResponse(input);
    expect(result).toEqual({ accounts: [{ name: "IRA" }] });
  });

  it("handles reasoning model output with thinking text before JSON", () => {
    const input =
      "Let me analyze this document carefully.\n\nThe statement shows several accounts.\n\n" +
      '```json\n{"accounts": [{"name": "401k", "value": 50000}]}\n```';
    const result = parseAIResponse(input);
    expect((result.accounts as Array<{name: string}>)[0].name).toBe("401k");
  });

  it("finds JSON via balanced brace matching from end", () => {
    const input =
      'Some text with {braces} in it, then the real JSON: {"accounts": [{"name": "Roth"}]}';
    const result = parseAIResponse(input);
    expect((result.accounts as Array<{name: string}>)[0].name).toBe("Roth");
  });

  it("falls back to first/last brace extraction", () => {
    const input = 'prefix {"data": true} suffix';
    const result = parseAIResponse(input);
    expect(result).toEqual({ data: true });
  });

  it("returns empty object for unparseable input", () => {
    const result = parseAIResponse("not json at all");
    expect(result).toEqual({});
  });

  it("returns empty object for empty input", () => {
    expect(parseAIResponse("")).toEqual({});
    expect(parseAIResponse(null as unknown as string)).toEqual({});
  });
});
