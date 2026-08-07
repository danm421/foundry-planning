import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/extraction/vision-ocr", () => ({ visionOcrPdf: vi.fn(), visionOcrImage: vi.fn() }));

import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrPdf, visionOcrImage } from "@/lib/extraction/vision-ocr";
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

  // The known Azure jailbreak filter blocks OCR on some documents, so this
  // catch is a live path, not a defensive one. Left uncaught it would surface
  // the raw provider error to the advisor.
  it("wraps a THROWN pdf OCR failure in a user-safe error", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([" "]);
    vi.mocked(visionOcrPdf).mockRejectedValue(new Error("content filter triggered"));

    const err = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "pdf", model: "mini",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(TaxReturnExtractionError);
    expect(err.message).toContain("content filter triggered");
    expect(err.userMessage).toMatch(/OCR failed/i);
  });

  it("transcribes an image upload and says the figures came from an image", async () => {
    vi.mocked(visionOcrImage).mockResolvedValue("Form W-2 wages 95000 SSN 123-45-6789");

    const result = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "png", model: "mini",
    });

    expect(extractPdfPages).not.toHaveBeenCalled();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toContain("95000");
    // The image lane redacts too — it shares the one exit point.
    expect(result.pages[0]).not.toContain("123-45-6789");
    expect(result.warnings.join(" ")).toMatch(/transcribed from an image/i);
  });

  it("wraps a THROWN image OCR failure in a user-safe error", async () => {
    vi.mocked(visionOcrImage).mockRejectedValue(new Error("vision endpoint 500"));

    const err = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "jpeg", model: "mini",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(TaxReturnExtractionError);
    expect(err.message).toContain("vision endpoint 500");
    expect(err.userMessage).toMatch(/image couldn't be read/i);
  });

  it("refuses an image whose transcription came back near-empty", async () => {
    vi.mocked(visionOcrImage).mockResolvedValue("   ");
    await expect(
      readDocumentText({ buffer: Buffer.from("x"), uploadKind: "jpeg", model: "mini" }),
    ).rejects.toBeInstanceOf(TaxReturnExtractionError);
  });

  // `UploadKind` carries three kinds this pipeline does not accept. Reaching
  // the AI with an empty page list would be worse than refusing.
  it("refuses an upload kind tax analysis does not accept", async () => {
    const err = await readDocumentText({
      buffer: Buffer.from("x"), uploadKind: "xlsx", model: "mini",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(TaxReturnExtractionError);
    expect(err.message).toContain("xlsx");
    expect(err.userMessage).toMatch(/PDF or image/i);
  });
});
