import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));
vi.mock("@/lib/extraction/vision-ocr", () => ({
  visionOcrPdf: vi.fn(),
  visionOcrImage: vi.fn(),
}));

import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import { visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { extractTaxReturnFacts, TaxReturnExtractionError } from "../extract-facts";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

const factsResponse = JSON.stringify({
  isAmended: false,
  facts: { ...emptyTaxReturnFacts(2025), filingStatus: "single" },
});

function pagesOfText(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Form page ${i + 1}\nwages 100`);
}

beforeEach(() => vi.clearAllMocks());

describe("extractTaxReturnFacts", () => {
  it("short PDF: single pass, no classifier call", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(pagesOfText(6));
    vi.mocked(callAIExtraction).mockResolvedValue(factsResponse);
    const result = await extractTaxReturnFacts({
      buffer: Buffer.from("x"), fileName: "t.pdf", uploadKind: "pdf", model: "full",
    });
    expect(result.facts.filingStatus).toBe("single");
    expect(callAIExtraction).toHaveBeenCalledTimes(1); // no classifier
  });

  it("long PDF: classifier selects pages, then one extraction call", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(pagesOfText(40));
    vi.mocked(callAIExtraction)
      .mockResolvedValueOnce(JSON.stringify({ relevantPages: [[1, 2], [11, 13]] }))
      .mockResolvedValueOnce(factsResponse);
    const result = await extractTaxReturnFacts({
      buffer: Buffer.from("x"), fileName: "t.pdf", uploadKind: "pdf", model: "full",
    });
    expect(callAIExtraction).toHaveBeenCalledTimes(2);
    const extractionInput = vi.mocked(callAIExtraction).mock.calls[1][1];
    expect(extractionInput).toContain("Form page 12");
    expect(extractionInput).not.toContain("Form page 30");
    expect(result.facts.taxYear).toBe(2025);
  });

  it("classifier failure falls back to leading pages with a warning", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(pagesOfText(40));
    vi.mocked(callAIExtraction)
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce(factsResponse);
    const result = await extractTaxReturnFacts({
      buffer: Buffer.from("x"), fileName: "t.pdf", uploadKind: "pdf", model: "full",
    });
    expect(result.warnings.some((w) => w.toLowerCase().includes("page selection"))).toBe(true);
  });

  it("scanned PDF: falls back to vision OCR with a warning", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([]);
    vi.mocked(visionOcrPdf).mockResolvedValue({
      text: "Form 1040 wages 100 ".repeat(10),
      pageCount: 3,
      pagesProcessed: 3,
      truncated: false,
    });
    vi.mocked(callAIExtraction).mockResolvedValue(factsResponse);
    const result = await extractTaxReturnFacts({
      buffer: Buffer.from("x"), fileName: "scan.pdf", uploadKind: "pdf", model: "full",
    });
    expect(result.warnings.some((w) => w.includes("OCR"))).toBe(true);
  });

  it("throws a user-facing error for amended returns", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(pagesOfText(4));
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({ isAmended: true, facts: emptyTaxReturnFacts(2025) }),
    );
    await expect(
      extractTaxReturnFacts({ buffer: Buffer.from("x"), fileName: "t.pdf", uploadKind: "pdf", model: "full" }),
    ).rejects.toThrow(TaxReturnExtractionError);
  });
});
