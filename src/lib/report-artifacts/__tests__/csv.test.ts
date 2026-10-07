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

  it("prefixes text that a spreadsheet would read as a formula", () => {
    expect(serializeCsv([["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tx", "\rx"]])).toBe(
      `'=1+1,'+1+1,'-1+1,'@SUM(A1),'\tx,"'\rx"\r\n`,
    );
  });

  it("prefixes a formula that also needs quoting", () => {
    expect(serializeCsv([['=HYPERLINK("https://example.invalid/","x")']])).toBe(
      `"'=HYPERLINK(""https://example.invalid/"",""x"")"\r\n`,
    );
  });

  it("leaves signed numbers and percentages as numbers", () => {
    expect(serializeCsv([["-1234.5", "-3.25%", "+2", "1,234", "-0"]])).toBe(
      '-1234.5,-3.25%,+2,"1,234",-0\r\n',
    );
  });

  it("coerces numbers and nulls", () => {
    expect(serializeCsv([["a", "b", "c"], [1 as unknown as string, "" as unknown as string, "x"]])).toBe(
      "a,b,c\r\n1,,x\r\n",
    );
  });
});
