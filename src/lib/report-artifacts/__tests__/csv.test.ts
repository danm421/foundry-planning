import { describe, it, expect } from "vitest";
import { serializeCsv } from "../csv";

describe("serializeCsv", () => {
  it("serializes simple rows", () => {
    expect(serializeCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes fields containing commas", () => {
    expect(serializeCsv([["a,b", "c"]])).toBe('"a,b",c\r\n');
  });

  it("quotes fields containing double quotes and escapes them", () => {
    expect(serializeCsv([['he said "hi"']])).toBe('"he said ""hi"""\r\n');
  });

  it("quotes fields containing newlines", () => {
    expect(serializeCsv([["line\nbreak"]])).toBe('"line\nbreak"\r\n');
  });

  it("handles empty array", () => {
    expect(serializeCsv([])).toBe("");
  });

  it("coerces numbers and nulls", () => {
    expect(serializeCsv([["a", "b", "c"], [1 as unknown as string, "" as unknown as string, "x"]])).toBe(
      "a,b,c\r\n1,,x\r\n",
    );
  });
});
