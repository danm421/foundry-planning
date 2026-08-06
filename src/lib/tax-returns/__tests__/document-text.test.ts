import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/extraction/vision-ocr", () => ({ visionOcrPdf: vi.fn(), visionOcrImage: vi.fn() }));

import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { readDocumentText } from "../document-text";
import { TaxReturnExtractionError } from "../errors";

beforeEach(() => vi.clearAllMocks());

describe("readDocumentText", () => {
  it("redacts SSNs out of every page", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["Taxpayer SSN 123-45-6789 wages 50000"]);
    const result = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "pdf", model: "mini",
    });
    expect(result.pages.join("")).not.toContain("123-45-6789");
    expect(result.pages.join("")).toContain("50000");
  });

  it("falls back to OCR when the PDF has no text layer, and says so", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([" "]);
    vi.mocked(visionOcrPdf).mockResolvedValue({
      text: "Schedule K-1 ordinary business income 40000",
      truncated: false, pagesProcessed: 1, pageCount: 1,
    } as never);
    const result = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "pdf", model: "mini",
    });
    expect(result.pages[0]).toContain("40000");
    expect(result.warnings.join(" ")).toMatch(/OCR/i);
  });

  it("throws a user-safe error when OCR also produces nothing", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([" "]);
    vi.mocked(visionOcrPdf).mockResolvedValue({
      text: "", truncated: false, pagesProcessed: 0, pageCount: 3,
    } as never);
    await expect(
      readDocumentText({ buffer: Buffer.from("x"), uploadKind: "pdf", model: "mini" }),
    ).rejects.toBeInstanceOf(TaxReturnExtractionError);
  });
});
