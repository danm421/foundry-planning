// src/lib/fact-finder/__tests__/route-file.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/extraction/vision-ocr", () => ({ visionOcrPdf: vi.fn(), visionOcrImage: vi.fn() }));
vi.mock("@/lib/extraction/docx-parser", () => ({ extractDocxText: vi.fn() }));
vi.mock("@/lib/extraction/classify", () => ({ classifyDocument: vi.fn() }));
vi.mock("../readers/form-reader", async () => {
  const actual = await vi.importActual<typeof import("../readers/form-reader")>("../readers/form-reader");
  return { ...actual, readFormFields: vi.fn() };
});

import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrImage, visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { extractDocxText } from "@/lib/extraction/docx-parser";
import { classifyDocument } from "@/lib/extraction/classify";
import { readFormFields } from "../readers/form-reader";
import { routeFile } from "../readers/route-file";

const buffer = Buffer.from("x");
const pdf = (documentType = "auto") => ({ buffer, fileName: "doc.pdf", detectedKind: "pdf", documentType });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFormFields).mockResolvedValue(null);
});

describe("routeFile", () => {
  it("sends spreadsheets and files typed as statements to the statement reader without opening them", async () => {
    expect(await routeFile({ buffer, fileName: "a.xlsx", detectedKind: "xlsx", documentType: "auto" })).toEqual({ reader: "statement" });
    expect(await routeFile(pdf("account_statement"))).toEqual({ reader: "statement" });
    expect(extractPdfPages).not.toHaveBeenCalled();
  });

  it("recognizes our own fact finder by its form", async () => {
    const fields = [{ name: "people_r1_c1", type: "text", value: "Mark", page: 1 }];
    vi.mocked(readFormFields).mockResolvedValue({ title: "Client Fact Finder", author: "Foundry Planning", fields });
    expect(await routeFile(pdf())).toEqual({ reader: "form", fields });
  });

  it("classifies a text PDF as a statement or a general document", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["page one", "page two"]);
    vi.mocked(classifyDocument).mockReturnValueOnce("account_statement");
    expect(await routeFile(pdf())).toEqual({ reader: "statement" });
    vi.mocked(classifyDocument).mockReturnValueOnce("insurance");
    expect(await routeFile(pdf())).toEqual({ reader: "section", pages: ["page one", "page two"], warnings: [] });
  });

  it("trusts an advisor's non-statement document type over the classifier", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["Last will and testament"]);
    expect(await routeFile(pdf("will"))).toMatchObject({ reader: "section" });
    expect(classifyDocument).not.toHaveBeenCalled();
  });

  it("OCRs a scanned PDF before classifying it (Review Focus 4)", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["", "  "]);
    vi.mocked(visionOcrPdf).mockResolvedValue({ text: "Policy text", segments: ["Policy text"], pageCount: 42, pagesProcessed: 30, truncated: true });
    vi.mocked(classifyDocument).mockReturnValueOnce("insurance");
    expect(await routeFile(pdf())).toEqual({
      reader: "section",
      pages: ["Policy text"],
      warnings: [
        "This PDF had no text layer, so its text was read with OCR — check the figures.",
        "Only the first 30 of 42 pages were read.",
      ],
    });
    vi.mocked(classifyDocument).mockReturnValueOnce("account_statement");
    expect(await routeFile(pdf())).toEqual({ reader: "statement" });
  });

  it("OCRs a scanned PDF one page at a time, so its pages line up 1:1 with the real pages", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["", "", ""]);
    vi.mocked(visionOcrPdf).mockResolvedValue({ text: "", segments: ["Page 1 text", "", "Page 3 text"], pageCount: 3, pagesProcessed: 3, truncated: false });
    vi.mocked(classifyDocument).mockReturnValueOnce("insurance");
    expect(await routeFile(pdf())).toMatchObject({ reader: "section", pages: ["Page 1 text", "", "Page 3 text"] });
    expect(visionOcrPdf).toHaveBeenCalledWith(buffer, expect.objectContaining({ batchSize: 1, keepEmptySegments: true }));
  });

  it("reads images with OCR and Word files as text", async () => {
    vi.mocked(visionOcrImage).mockResolvedValue("Social Security statement");
    vi.mocked(classifyDocument).mockReturnValue("insurance");
    expect(await routeFile({ buffer, fileName: "ssa.png", detectedKind: "png", documentType: "auto" })).toMatchObject({
      reader: "section",
      pages: ["Social Security statement"],
    });
    vi.mocked(extractDocxText).mockResolvedValue("Client data summary");
    expect(await routeFile({ buffer, fileName: "ff.docx", detectedKind: "docx", documentType: "auto" })).toMatchObject({
      reader: "section",
      pages: ["Client data summary"],
    });
  });

  it("fails a file it can't get any text from", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue([""]);
    vi.mocked(visionOcrPdf).mockResolvedValue({ text: "", segments: [""], pageCount: 1, pagesProcessed: 1, truncated: false });
    await expect(routeFile(pdf())).rejects.toThrow("Couldn't read any text from this file.");
  });
});
