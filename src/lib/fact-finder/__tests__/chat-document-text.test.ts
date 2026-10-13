// src/lib/fact-finder/__tests__/chat-document-text.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/imports/blob", () => ({ downloadImportFile: vi.fn() }));
vi.mock("@/lib/extraction/pdf-parser", () => ({ extractPdfPages: vi.fn() }));
vi.mock("@/lib/extraction/vision-ocr", () => ({ visionOcrPdf: vi.fn(), visionOcrImage: vi.fn() }));
vi.mock("@/lib/extraction/docx-parser", () => ({ extractDocxText: vi.fn() }));

import { downloadImportFile } from "@/lib/imports/blob";
import { extractPdfPages } from "@/lib/extraction/pdf-parser";
import { visionOcrImage, visionOcrPdf } from "@/lib/extraction/vision-ocr";
import { readDocumentPages } from "../chat/document-text";

const file = (detectedKind: string) => ({ blobUrl: "blob://statement", originalFilename: "statement.pdf", detectedKind });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(downloadImportFile).mockResolvedValue(Buffer.from("x"));
});

describe("readDocumentPages", () => {
  it("downloads the file and returns its page text with SSNs redacted", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["Member SSN 123-45-6789", "Balance $12,500"]);
    expect(await readDocumentPages(file("pdf"))).toEqual(["Member SSN [REDACTED-SSN]", "Balance $12,500"]);
    expect(downloadImportFile).toHaveBeenCalledWith("blob://statement");
    expect(visionOcrPdf).not.toHaveBeenCalled();
  });

  it("reads a scan with OCR, and redacts that text too", async () => {
    vi.mocked(extractPdfPages).mockResolvedValue(["", "  "]);
    vi.mocked(visionOcrPdf).mockResolvedValue({
      segments: ["Scanned SSN 123 45 6789"],
      pageCount: 2,
      pagesProcessed: 2,
      truncated: false,
    } as never);
    expect(await readDocumentPages(file("pdf"))).toEqual(["Scanned SSN [REDACTED-SSN]"]);
    vi.mocked(visionOcrImage).mockResolvedValue("Photo SSN 123456789");
    expect(await readDocumentPages(file("png"))).toEqual(["Photo SSN [REDACTED-SSN]"]);
  });

  it("says which file couldn't be downloaded", async () => {
    vi.mocked(downloadImportFile).mockResolvedValue(null);
    await expect(readDocumentPages(file("pdf"))).rejects.toThrow('Couldn\'t download "statement.pdf".');
  });
});
