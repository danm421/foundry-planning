// src/lib/extraction/__tests__/vision-ocr.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { renderPageAsImage, getDocumentProxy } = vi.hoisted(() => ({
  renderPageAsImage: vi.fn(),
  getDocumentProxy: vi.fn(),
}));
vi.mock("unpdf", () => ({ getDocumentProxy, renderPageAsImage }));

// sharp(buffer).resize(...).jpeg(...).toBuffer() chain → returns a tiny buffer.
vi.mock("sharp", () => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("img")),
  };
  return { default: vi.fn(() => chain) };
});

const { callAIVisionTranscription } = vi.hoisted(() => ({
  callAIVisionTranscription: vi.fn(),
}));
vi.mock("../azure-client", () => ({ callAIVisionTranscription }));

import { visionOcrPdf } from "../vision-ocr";

beforeEach(() => {
  vi.stubEnv("AZURE_API_KEY", "test-key");
  renderPageAsImage.mockReset().mockResolvedValue(new ArrayBuffer(4));
  getDocumentProxy.mockReset();
  callAIVisionTranscription.mockReset();
});

describe("visionOcrPdf", () => {
  it("transcribes pages in batches and concatenates in order", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 5 });
    callAIVisionTranscription
      .mockResolvedValueOnce("BATCH-A")   // pages 1-4
      .mockResolvedValueOnce("BATCH-B");  // page 5

    const res = await visionOcrPdf(Buffer.from("pdf"), { maxPages: 30, model: "mini", batchSize: 4 });

    expect(res.pageCount).toBe(5);
    expect(res.pagesProcessed).toBe(5);
    expect(res.truncated).toBe(false);
    expect(res.text).toBe("BATCH-A\n\nBATCH-B");
    expect(renderPageAsImage).toHaveBeenCalledTimes(5);
  });

  it("caps at maxPages and reports truncated", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 10 });
    callAIVisionTranscription.mockResolvedValue("X");

    const res = await visionOcrPdf(Buffer.from("pdf"), { maxPages: 3, model: "mini", batchSize: 4 });

    expect(res.pageCount).toBe(10);
    expect(res.pagesProcessed).toBe(3);
    expect(res.truncated).toBe(true);
    expect(renderPageAsImage).toHaveBeenCalledTimes(3);
  });

  it("fails closed when AZURE_API_KEY is unset", async () => {
    vi.stubEnv("AZURE_API_KEY", "");
    await expect(
      visionOcrPdf(Buffer.from("pdf"), { maxPages: 30, model: "mini" }),
    ).rejects.toThrow(/AZURE_API_KEY/);
  });

  it("interleaves rendering with transcription instead of rendering all pages up front", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 6 });
    // Record how many pages had been rendered at the moment each batch's
    // transcription was kicked off. Eager rendering would render all 6 pages
    // before the first transcription call (→ [6, 6, 6]); a pipeline renders
    // only one batch ahead (→ [2, 4, 6]).
    const rendersWhenTranscribed: number[] = [];
    callAIVisionTranscription.mockImplementation(async () => {
      rendersWhenTranscribed.push(renderPageAsImage.mock.calls.length);
      return "T";
    });

    await visionOcrPdf(Buffer.from("pdf"), {
      maxPages: 30,
      model: "mini",
      batchSize: 2,
      concurrency: 2,
    });

    expect(rendersWhenTranscribed).toEqual([2, 4, 6]);
  });

  it("stops rendering ahead once `concurrency` transcriptions are outstanding", async () => {
    getDocumentProxy.mockResolvedValue({ numPages: 8 });
    // Transcriptions never settle, so the in-flight window stays full and the
    // render loop must block rather than rasterize every remaining page.
    callAIVisionTranscription.mockReturnValue(new Promise<string>(() => {}));

    // Don't await — it would hang by design. Let the microtask queue drain.
    void visionOcrPdf(Buffer.from("pdf"), {
      maxPages: 30,
      model: "mini",
      batchSize: 2,
      concurrency: 2,
    });
    await new Promise((r) => setTimeout(r, 0));

    // Only the first concurrency*batchSize pages render; the rest wait behind
    // the full window — bounding peak memory to the in-flight JPEGs.
    expect(renderPageAsImage).toHaveBeenCalledTimes(4);
  });
});
