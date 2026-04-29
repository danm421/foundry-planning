import { describe, it, expect } from "vitest";
import { extractPdfText, extractPdfPages } from "../pdf-parser";

describe("extractPdfText", () => {
  it("returns empty string for empty buffer", async () => {
    const result = await extractPdfText(Buffer.from(""));
    expect(result).toBe("");
  });

  it("returns empty string for invalid PDF", async () => {
    const result = await extractPdfText(Buffer.from("not a pdf"));
    expect(result).toBe("");
  });
});

describe("extractPdfPages", () => {
  it("returns empty array for empty buffer", async () => {
    const result = await extractPdfPages(Buffer.from(""));
    expect(result).toEqual([]);
  });

  it("returns empty array for invalid PDF", async () => {
    const result = await extractPdfPages(Buffer.from("not a pdf"));
    expect(result).toEqual([]);
  });
});
