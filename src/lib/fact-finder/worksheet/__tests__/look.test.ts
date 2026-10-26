import { beforeEach, describe, expect, it, vi } from "vitest";

const { downloadImportFile, visionOcrPdf, visionOcrImage } = vi.hoisted(() => ({
  downloadImportFile: vi.fn(),
  visionOcrPdf: vi.fn(),
  visionOcrImage: vi.fn(),
}));
vi.mock("@/lib/imports/blob", () => ({ downloadImportFile }));
vi.mock("@/lib/extraction/vision-ocr", () => ({ visionOcrPdf, visionOcrImage }));

import { lookAtPages } from "../look";

const file = (detectedKind: string) => ({ id: "f1", blobUrl: "blob://f1", originalFilename: "schwab.pdf", detectedKind, documentType: "auto" });
const bytes = Buffer.from("bytes");

beforeEach(() => {
  downloadImportFile.mockReset().mockResolvedValue(bytes);
  visionOcrPdf.mockReset();
  visionOcrImage.mockReset();
});

describe("lookAtPages", () => {
  it("reads a PDF's chosen pages with the full model, SSNs redacted", async () => {
    visionOcrPdf.mockResolvedValue({ text: "Owner SSN 123-45-6789, value 431,050" });
    const out = await lookAtPages(file("pdf"), [3, 1]);
    expect(downloadImportFile).toHaveBeenCalledWith("blob://f1");
    expect(visionOcrPdf).toHaveBeenCalledWith(bytes, { pages: [3, 1], maxPages: 2, model: "full" });
    expect(out).toBe("Owner SSN [REDACTED-SSN], value 431,050");
  });

  it("reads an image whole, and refuses a file with no pages to look at", async () => {
    visionOcrImage.mockResolvedValue("Balance 12,500");
    expect(await lookAtPages(file("png"), [1])).toBe("Balance 12,500");
    expect(visionOcrImage).toHaveBeenCalledWith(bytes, { model: "full" });
    await expect(lookAtPages(file("docx"), [1])).rejects.toThrow("read_document");
    expect(downloadImportFile).toHaveBeenCalledTimes(1);
  });
});
