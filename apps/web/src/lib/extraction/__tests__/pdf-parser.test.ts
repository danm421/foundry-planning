import { describe, it, expect } from "vitest";
import { extractPdfText } from "../pdf-parser";

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
